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
  console.warn(
    "   KV bindings (TRANSLATION_KV_ID, REPORTS_KV_ID) will likely fail.",
  );
}

console.log(
  "🚀 Deploying worker (loaded " + loaded + " env vars from .dev.vars)",
);
console.log(
  "   CLOUDFLARE_API_TOKEN: " +
    (process.env.CLOUDFLARE_API_TOKEN ? "set" : "MISSING"),
);
console.log(
  "   TRANSLATION_KV_ID: " +
    (process.env.TRANSLATION_KV_ID ? "set" : "MISSING"),
);
console.log(
  "   REPORTS_KV_ID: " + (process.env.REPORTS_KV_ID ? "set" : "MISSING"),
);

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error(
    "❌ CLOUDFLARE_API_TOKEN is required. Run: wrangler login or set it in .dev.vars",
  );
  process.exit(1);
}

try {
  execSync("npx wrangler deploy", {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
} catch (e) {
  console.error(
    "❌ Worker deployment failed. Check your CLOUDFLARE_API_TOKEN and KV namespace IDs.",
  );
  process.exit(1);
}
