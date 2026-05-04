#!/usr/bin/env npx tsx

/**
 * Project Information Dashboard
 * Displays current project configuration, environment, and deployment status.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
// import { formatTimestamp, VERSION } from '../shared/utils.js';
const VERSION = "1.0.80"; // Fallback
const formatTimestamp = (d: any) => new Date(d).toLocaleString();

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PackageJson {
  name: string;
  version: string;
  type?: string;
  [key: string]: any;
}

function section(title: string): void {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(50));
}

function runGit(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "N/A";
  }
}

function getFolderSize(dir: string): string {
  let size = 0;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      size += getFolderSize(full) === "0 Bytes" ? 0 : 1; // Basic recursion placeholder
    } else {
      try {
        size += fs.statSync(full).size;
      } catch {}
    }
  }
  return formatBytes(size);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Main
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
) as PackageJson;

section("📦 Project");
console.log(`Name:    ${pkg.name}`);
console.log(`Version: ${VERSION} (pkg: ${pkg.version})`);
console.log(`Type:    ${pkg.type}`);

section("🔗 URLs");
console.log(`Worker:  https://dor-progress.banjays.workers.dev`);
console.log(`Firebase: https://dor-progress.web.app`);

const remoteUrl = runGit("remote get-url origin");
console.log(
  `GitHub:   ${remoteUrl.replace(/^.*github.com[:\/]/, "").replace(".git", "")}`,
);

section("🌿 Git");
console.log(`Branch:    ${runGit("branch --show-current")}`);
console.log(`Last comm: ${runGit("log -1 --oneline")}`);
const tags = runGit("tag --sort=-version:refname").split("\n").filter(Boolean);
console.log(`Tags:      ${tags.slice(0, 5).join(", ") || "none"}`);

section("⚙️ Wrangler");
try {
  const wrangler = fs.readFileSync(
    path.resolve(process.cwd(), "wrangler.toml"),
    "utf8",
  );
  const lines = wrangler.split("\n");
  console.log(
    `Name:         ${
      lines
        .find((l) => l.trim().startsWith("name = "))
        ?.split("=")[1]
        ?.trim()
        .replace(/"/g, "") || "N/A"
    }`,
  );
  console.log(
    `Worker:       ${
      lines
        .find((l) => l.trim().startsWith("main = "))
        ?.split("=")[1]
        ?.trim()
        .replace(/"/g, "") || "index.ts"
    }`,
  );
  console.log(
    `Compatibility: ${
      lines
        .find((l) => l.trim().startsWith("compatibility_date = "))
        ?.split("=")[1]
        ?.trim()
        .replace(/"/g, "") || "N/A"
    }`,
  );
} catch {
  console.log("❌ wrangler.toml not found");
}

section("🔥 Firebase");
try {
  const firebase = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "firebase.json"), "utf8"),
  );
  console.log(`Public dir: ${firebase.hosting?.public || "public"}`);
  console.log(`Headers:    ${firebase.hosting?.headers?.length || 0} rules`);
  console.log(`Rewrites:   ${firebase.hosting?.rewrites?.length || 0} rules`);
} catch {
  console.log("❌ firebase.json not found");
}

section("📂 Project Structure");
const publicDir = path.resolve(process.cwd(), "public");
if (fs.existsSync(publicDir)) {
  const files = fs.readdirSync(publicDir);
  console.log(`Public (${files.length}): ${files.join(", ")}`);
}

const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  const size = getFolderSize(distDir);
  console.log(`Dist:   ${size}`);
} else {
  console.log(`Dist:   (not built)`);
}

const buildDir = path.resolve(process.cwd(), ".build");
if (fs.existsSync(buildDir)) {
  const size = getFolderSize(buildDir);
  console.log(`Build:  ${size}`);
} else {
  console.log(`Build:  (not built)`);
}

section("🔐 Secrets (.dev.vars)");
const devVarsPath = path.resolve(process.cwd(), ".dev.vars");
if (fs.existsSync(devVarsPath)) {
  const content = fs.readFileSync(devVarsPath, "utf8");
  const keys = content
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=")[0]);

  const sheetLine = content
    .split("\n")
    .find((l) => l.startsWith("PUBLISHED_SHEET_ID="));
  const rawId = sheetLine?.split("=")[1]?.trim();
  const parsedId = rawId?.includes("/d/e/")
    ? rawId.split("/d/e/")[1].split("/")[0]
    : rawId;

  console.log(`Loaded:  ${keys.join(", ")}`);
  if (parsedId)
    console.log(
      `SheetID: ${parsedId.substring(0, 8)}...${parsedId.substring(parsedId.length - 8)}`,
    );
} else {
  console.log("No .dev.vars file found (local secrets)");
}

section("✅ Pre-deploy Checks");
const issues: string[] = [];

const hasDevVars = fs.existsSync(devVarsPath);
const devVarsContent = hasDevVars ? fs.readFileSync(devVarsPath, "utf8") : "";

if (!hasDevVars) {
  issues.push("No .dev.vars (local secrets file is missing)");
} else if (!devVarsContent.includes("PUBLISHED_SHEET_ID")) {
  issues.push(
    "PUBLISHED_SHEET_ID is missing from .dev.vars (required for translations)",
  );
}

if (!fs.existsSync(buildDir))
  issues.push("Firebase not built (run: npm run build)");
if (issues.length) {
  for (const issue of issues) console.log(`  ⚠️  ${issue}`);
} else {
  console.log("  All systems ready ✅");
}

console.log("\n");
