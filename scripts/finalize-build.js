import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

const buildDir = path.resolve(".build");
const swPath = path.join(buildDir, "sw.v2.js");
const pkgPath = path.resolve("package.json");
const versionPath = path.resolve("VERSION");

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

  // Read version from VERSION file, fallback to package.json
  const versionIdentifier = fs.existsSync(versionPath)
    ? fs.readFileSync(versionPath, "utf8").trim()
    : pkg.version;

  // Get the actual Git commit SHA - prefer CI environment variables over git command
  const envSha = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || process.env.COMMIT_SHA;
  let commitSha = "unknown";
  if (envSha) {
    commitSha = envSha.substring(0, 7); // Use short SHA
  } else {
    try {
      commitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch (e) {
      console.warn("⚠️  Could not determine Git commit SHA, using fallback");
    }
  }

  sw = sw
    .replace(/__API_BASE_URL__/g, apiBase)
    .replace(/__BUILD_ID__/g, buildId)
    .replace(/__COMMIT_SHA__/g, commitSha)
    .replace(/__VERSION__/g, versionIdentifier);

  fs.writeFileSync(swPath, sw);
  console.log("✅ Service Worker environment variables injected");
  console.log(`   Build ID: ${buildId}, Commit: ${commitSha}, Version: ${versionIdentifier}`);
} else {
  console.warn("⚠️ sw.v2.js not found in .build");
}
