import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const devVarsPath = path.resolve(process.cwd(), ".dev.vars");
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
  console.warn(
    "⚠️  .dev.vars not found or empty. Deploying without local env vars.",
  );
  console.warn("   KV bindings (TRANSLATION_KV_ID, REPORTS_KV_ID) may fail.");
}

console.log(
  "🚀 Deploying worker (loaded " + loaded + " env vars from .dev.vars)",
);
console.log(
  "   TRANSLATION_KV_ID: " +
    (process.env.TRANSLATION_KV_ID ? "set" : "MISSING"),
);
console.log(
  "   REPORTS_KV_ID: " + (process.env.REPORTS_KV_ID ? "set" : "MISSING"),
);

try {
  execSync("npx wrangler deploy", {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
} catch (e) {
  console.error("❌ Worker deployment failed.");
  process.exit(1);
}
