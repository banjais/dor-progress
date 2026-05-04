#!/usr/bin/env node

/**
 * Build Verification
 * Checks that all required build artifacts exist after compilation.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const checks = [
  { name: "Build directory", path: ".build", required: true, type: "dir" },
  {
    name: "Assets directory",
    path: ".build/assets",
    required: true,
    type: "dir",
  },
  { name: "Built index.html", path: ".build/index.html", required: true },
  { name: "Built service worker", path: ".build/sw.v2.js", required: true },
  { name: "Built manifest", path: ".build/manifest.json", required: false },
  { name: "Firebase config", path: "firebase.json", required: true },
  { name: "Wrangler config", path: "wrangler.toml", required: true },
];

let errors = 0;

console.log("\n🔍 Verifying build artifacts...\n");

for (const check of checks) {
  const fullPath = path.resolve(process.cwd(), check.path);
  const exists = fs.existsSync(fullPath);

  if (exists) {
    const stats = fs.statSync(fullPath);
    const size = stats.isDirectory() ? "(dir)" : `${stats.size} bytes`;
    console.log(`✅ ${check.name}: ${check.path} ${size}`);

    // Extra check for assets directory
    if (check.path === ".build/assets") {
      const assets = fs.readdirSync(fullPath);
      const hasJs = assets.some((a) => a.endsWith(".js"));
      const hasCss = assets.some((a) => a.endsWith(".css"));
      if (!hasJs) {
        console.log("❌ Assets: No .js files found");
        errors++;
      } else {
        console.log(
          `   ✅ Found ${assets.filter((a) => a.endsWith(".js")).length} JS asset(s)`,
        );
      }
      if (!hasCss) {
        console.log("❌ Assets: No .css files found");
        errors++;
      } else {
        console.log(
          `   ✅ Found ${assets.filter((a) => a.endsWith(".css")).length} CSS asset(s)`,
        );
      }
    }
  } else {
    console.log(`❌ ${check.name}: ${check.path} - MISSING`);
    if (check.required) errors++;
  }
}

console.log("");

if (errors > 0) {
  console.error(
    `❌ Build verification failed: ${errors} required file(s) missing.`,
  );
  process.exit(1);
} else {
  console.log("✅ All build artifacts verified.\n");
  process.exit(0);
}
