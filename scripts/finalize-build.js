import fs from "fs";
import path from "path";
import crypto from "crypto";

const buildDir = path.resolve(".build");
const swPath = path.join(buildDir, "sw.v2.js");
const pkgPath = path.resolve("package.json");

if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, "utf8");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  const apiBase = process.env.API_BASE_URL || "";

  // Generate a deterministic hash based on the file content itself
  const contentHash = crypto
    .createHash("md5")
    .update(sw)
    .digest("hex")
    .slice(0, 10);
  const buildId = contentHash;
  const versionIdentifier = pkg.version;

  sw = sw
    .replace(/__API_BASE_URL__/g, apiBase)
    .replace(/__BUILD_ID__/g, buildId)
    .replace(/__COMMIT_SHA__/g, versionIdentifier);

  fs.writeFileSync(swPath, sw);
  console.log("✅ Service Worker environment variables injected");
} else {
  console.warn("⚠️ sw.v2.js not found in .build");
}
