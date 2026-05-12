import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const devVarsPath = path.resolve(process.cwd(), ".dev.vars");
const wranglerPath = path.resolve(process.cwd(), "wrangler.toml");
const wranglerBackup = wranglerPath + ".bak";

// Load .dev.vars
let loaded = 0;
if (fs.existsSync(devVarsPath)) {
  const content = fs.readFileSync(devVarsPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.substring(0, idx).trim();
      const value = trimmed.substring(idx + 1).trim();
      process.env[key] = value;
      loaded++;
    }
  }
}

if (loaded === 0) {
  console.warn("⚠️  .dev.vars not found or empty.");
  console.warn("   KV bindings will likely fail.");
}

console.log(
  "🚀 Deploying worker (loaded " + loaded + " env vars from .dev.vars)",
);
console.log(
  "   CLOUDFLARE_API_TOKEN: " +
    (process.env.CLOUDFLARE_API_TOKEN ? "set" : "MISSING"),
);
console.log(
  "   TRANSLATION_KV_ID: " + (process.env.TRANSLATION_KV_ID || "MISSING"),
);
console.log("   REPORTS_KV_ID: " + (process.env.REPORTS_KV_ID || "MISSING"));

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error("❌ CLOUDFLARE_API_TOKEN is required.");
  process.exit(1);
}

// Resolve wrangler.toml env vars by writing a temp copy with values filled in
const originalWrangler = fs.readFileSync(wranglerPath, "utf8");
let resolvedWrangler = originalWrangler;

// Replace all ${VAR_NAME} or ${var.VAR_NAME} placeholders
const varRegex = /\$\{(?:var\.)?([A-Z_][A-Z0-9_]*)\}/g;
resolvedWrangler = resolvedWrangler.replace(varRegex, (match, varName) => {
  return process.env[varName] || match;
});

try {
  // Backup original and write resolved version
  fs.writeFileSync(wranglerBackup, originalWrangler);
  fs.writeFileSync(wranglerPath, resolvedWrangler);

  execSync("npx wrangler deploy", { stdio: "inherit", cwd: process.cwd() });
} catch (e) {
  console.error("❌ Worker deployment failed.");
  process.exit(1);
} finally {
  // Restore original wrangler.toml
  if (fs.existsSync(wranglerBackup)) {
    fs.writeFileSync(wranglerPath, fs.readFileSync(wranglerBackup));
    fs.unlinkSync(wranglerBackup);
  }
}
