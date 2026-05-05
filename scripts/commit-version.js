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
  execSync("git add package.json pnpm-lock.yaml", { stdio: "inherit" });
  execSync(`git commit -m "chore: bump version to ${version}"`, {
    stdio: "inherit",
  });
  execSync(`git tag -a "v${version}" -m "Release v${version}"`, {
    stdio: "inherit",
  });
  console.log(`✅ Version ${version} committed and tagged.`);
  console.log(`   Push with: git push && git push --tags`);
} catch (err) {
  console.error("❌ Failed to commit version:", err.message);
  process.exit(1);
}
