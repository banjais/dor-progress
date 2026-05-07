#!/usr/bin/env node
/**
 * Translation Synchronization Script
 * Downloads CSV from Google Sheets, parses it into JSON,
 * and performs an integrity check using SHA-256 fingerprinting.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

// 💡 Configured via environment variable for security and flexibility
const isDryRun = process.argv.includes("--dry-run");

/**
 * Automatically load .dev.vars if running locally without environment variables set
 */
if (!process.env.PUBLISHED_SHEET_ID) {
  const devVarsPath = path.resolve(process.cwd(), ".dev.vars");
  if (fs.existsSync(devVarsPath)) {
    const content = fs.readFileSync(devVarsPath, "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const [key, ...val] = line.split("=");
      if (key && val.length > 0) process.env[key.trim()] = val.join("=").trim();
    });
  }
}

const rawId = process.env.PUBLISHED_SHEET_ID;

// Helper: Extract Sheet ID from a full URL if provided, otherwise use as is
const PUBLISHED_SHEET_ID = rawId?.includes("/d/e/")
  ? rawId.split("/d/e/")[1].split("/")[0]
  : rawId?.includes("/d/")
    ? rawId.split("/d/")[1].split("/")[0]
    : rawId;

const PUBLISHED_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_SHEET_ID}/pub?output=csv`;

const OUTPUT_PATH = path.resolve(
  process.cwd(),
  "src/locales/translations.json",
);
const PUBLIC_PATH = path.resolve(process.cwd(), "public/translations.json");
const BUILD_PATH = path.resolve(process.cwd(), ".build/translations.json");

// Helper to sort object keys alphabetically for consistent diffs
function sortObject(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

async function syncTranslations() {
  if (!PUBLISHED_SHEET_ID) {
    console.warn(
      "⚠️  Skipping translation sync: PUBLISHED_SHEET_ID not found in environment or .dev.vars",
    );
    return;
  }

  console.log(
    `🌐 Syncing translations for Sheet ID: ${PUBLISHED_SHEET_ID.substring(0, 8)}...`,
  );

  let baseline = null;
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      // Load existing file to check fingerprint before writing
      baseline = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
    } catch {
      /* ignore baseline if file is missing or invalid JSON */
    }
  }

  try {
    let response;
    const maxRetries = 3;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        response = await fetch(PUBLISHED_URL);
        if (response.ok) break; // Success, exit loop

        // If not OK, but not a hard error (e.g., 404, 403), retry
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          throw new Error(
            `Non-retryable HTTP error: ${response.status} ${response.statusText}`,
          );
        }
        throw new Error(
          `Failed to fetch (status: ${response.status} ${response.statusText})`,
        );
      } catch (error) {
        if (i < maxRetries) {
          const delay = Math.pow(2, i) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.warn(
            `⚠️ Attempt ${i + 1}/${maxRetries + 1} failed. Retrying in ${delay / 1000}s... (${error.message})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          throw error; // Last attempt failed, re-throw
        }
      }
    }

    if (!response || !response.ok)
      throw new Error(`Failed to fetch after ${maxRetries + 1} attempts.`);

    const csvText = await response.text();
    // Regex to handle CSV quoting (escaped commas)
    const rows = csvText
      .split(/\r?\n/)
      .map((row) => row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/));

    // Single Tab Logic: Columns are [Key, English, Nepali]
    const newContent = {
      en: {},
      ne: {},
      _metadata: { syncAt: new Date().toISOString() },
    };

    const duplicates = [];
    const missing = [];
    const unchanged = [];
    const nestedKeys = [];

    rows.slice(1).forEach((row) => {
      if (row && row.length >= 3) {
        // Clean quotes and trim whitespace
        const key = row[0]?.replace(/^"|"$/g, "").trim();
        const enVal = row[1]?.replace(/^"|"$/g, "").trim();
        const neVal = row[2]?.replace(/^"|"$/g, "").trim();

        if (key) {
          // Validation: Flat structure only (no dots allowed in keys)
          // This keeps the i18n implementation simple and predictable
          if (key.includes(".")) {
            nestedKeys.push(key);
          }

          if (key in newContent.en) {
            duplicates.push(key);
          }

          // Flag keys that haven't changed from the local baseline values
          if (
            baseline &&
            baseline.en?.[key] === enVal &&
            baseline.ne?.[key] === neVal
          ) {
            unchanged.push(key);
          }

          if (!enVal || !neVal) {
            missing.push({ key, en: !enVal, ne: !neVal });
          }
          newContent.en[key] = enVal;
          newContent.ne[key] = neVal;
        }
      }
    });

    // Critical Validation Phase
    let hasErrors = false;
    if (duplicates.length > 0) {
      console.error(
        `❌ Error: Found ${duplicates.length} duplicate key(s) in the Google Sheet:`,
      );
      duplicates.forEach((k) => console.error(`   - ${k}`));
      hasErrors = true;
    }

    if (missing.length > 0) {
      console.error(
        `❌ Error: Found ${missing.length} key(s) with missing translations:`,
      );
      missing.forEach((m) => {
        const langs = [];
        if (m.en) langs.push("English");
        if (m.ne) langs.push("Nepali");
        console.error(`   - ${m.key} (Missing: ${langs.join(" & ")})`);
      });
      hasErrors = true;
    }

    if (nestedKeys.length > 0) {
      console.error(
        `❌ Error: Found ${nestedKeys.length} key(s) containing dots (nested objects are forbidden):`,
      );
      nestedKeys.forEach((k) => console.error(`   - ${k}`));
      hasErrors = true;
    }

    // Fail fast in CI if translations are corrupted
    if (hasErrors) process.exit(1);

    const sortedEn = sortObject(newContent.en);
    const sortedNe = sortObject(newContent.ne);

    // FINGERPRINT CHECK: Check if content actually changed
    const fingerprint = crypto
      .createHash("sha256")
      .update(JSON.stringify({ en: sortedEn, ne: sortedNe }))
      .digest("hex");
    newContent._metadata.fingerprint = fingerprint;

    if (baseline && baseline._metadata?.fingerprint === fingerprint) {
      console.log(
        `✨ Already up to date (fingerprint: ${fingerprint.substring(0, 8)}).`,
      );
      return;
    }

    // Execution Phase
    if (isDryRun) {
      console.log(`\n--- DRY RUN: No files were written ---`);
      console.log(`Would sync ${Object.keys(newContent.en).length} keys.`);
      console.log(`New Fingerprint: ${fingerprint}`);
      return;
    }

    const finalOutput = {
      en: sortedEn,
      ne: sortedNe,
      _metadata: newContent._metadata,
    };
    const jsonContent = JSON.stringify(finalOutput, null, 2);

    // Atomic Write Operations
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, jsonContent); // Source code baseline

    // 2. Write to public (Ensures it is bundled into the final build artifact)
    fs.mkdirSync(path.dirname(PUBLIC_PATH), { recursive: true });
    fs.writeFileSync(PUBLIC_PATH, jsonContent);

    // 3. Write to .build (Ensures build artifacts are consistent even if sync runs before build)
    fs.mkdirSync(path.dirname(BUILD_PATH), { recursive: true });
    fs.writeFileSync(BUILD_PATH, jsonContent);

    // 4. Post-sync Formatting Step
    try {
      console.log("✨ Formatting generated files...");
      execSync(`pnpm exec prettier --write "${OUTPUT_PATH}" "${PUBLIC_PATH}"`, {
        stdio: "ignore",
      });
    } catch {
      console.warn(
        "⚠️  Note: Prettier formatting skipped (not installed or failed).",
      );
    }

    console.log(
      `✅ Successfully synced ${Object.keys(finalOutput.en).length} keys.`,
    );
  } catch (error) {
    console.error("❌ Error syncing translations:", error.message);
    // In CI, don't fail the build if translations can't sync - use existing files
    // Check if we're in CI environment
    if (process.env.GITHUB_ACTIONS) {
      console.warn(
        "⚠️ CI mode: Using existing translations to continue build.",
      );
      process.exit(0); // Exit successfully to not break CI
    }
    process.exit(1);
  }
}

syncTranslations();
