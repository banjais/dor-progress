#!/usr/bin/env node

/**
 * Commit Version
 * Commits package.json changes and creates a git tag.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.resolve(process.cwd(), "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;

console.log(`📦 Version: ${version}`);

try {
  // 1. Robust Sync: Ensure index is clean and free of phantom references (like .qwen)
  // This prevents Windows path resolution errors during Husky hooks.
  execSync("git add -A", { stdio: "inherit" });
  try {
    // Specific fix for the phantom directory pollution in the Git index
    execSync("git rm -r --cached .qwen --ignore-unmatch", { stdio: "ignore" });
    execSync("git add .", { stdio: "ignore" });
  } catch (e) {
    /* Ignore errors if directory is not in index */
  }

  // 2. Check for staged changes
  // Prevents the script from failing if package.json was not actually modified.
  const stagedFiles = execSync("git diff --cached --name-only", {
    encoding: "utf8",
  }).trim();

  if (stagedFiles) {
    console.log("💾 Committing version changes...");
    execSync(`git commit -m "chore: bump version to ${version}"`, {
      stdio: "inherit",
    });
    console.log(`✅ Version ${version} committed.`);
  } else {
    console.log("ℹ️ No changes detected to commit.");
  }

  // 3. Handle Tagging gracefully
  // Check if tag exists first to avoid conflict errors during deployment retries.
  let tagExists = false;
  try {
    execSync(`git rev-parse v${version}`, { stdio: "ignore" });
    tagExists = true;
  } catch (e) {}

  if (!tagExists) {
    execSync(`git tag -a "v${version}" -m "Release v${version}"`, {
      stdio: "inherit",
    });
    console.log(`✅ Tagged as v${version}`);
  } else {
    console.log(`⚠️  Tag v${version} already exists. Skipping tag creation.`);
  }

  console.log(`   Push with: git push && git push --tags`);
} catch (err) {
  console.error("❌ Failed to commit version:", err.message);
  process.exit(1);
}
