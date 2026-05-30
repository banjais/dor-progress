// scripts/deploy.js

import { spawnSync, execSync } from "child_process";
import fs from "fs";
import "dotenv/config";

process.env.NODE_NO_WARNINGS = "1";

const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

const run = (command, args = [], options = {}) => {
  const useShell = process.platform === "win32";

  // When using shell mode with verbatim arguments on Windows, Node.js skips
  // automatic escaping. We must manually quote arguments containing spaces or parentheses.
  const finalArgs = useShell
    ? args.map(arg => (/[ ()]/.test(arg) ? `"${arg}"` : arg))
    : args;

  const result = spawnSync(command, finalArgs, {
    stdio: "inherit",
    shell: useShell,
    windowsVerbatimArguments: true,
    ...options,
  });

  if (result.status !== 0) {
    console.error(
      `${colors.red}❌ Command failed:${colors.reset}`,
      command,
      args.join(" ")
    );
    process.exit(result.status || 1);
  }
};

console.log(
  `${colors.bold}${colors.cyan}🚀 Starting DoR Progress Deployment${colors.reset}\n`
);

// ─────────────────────────────────────────────────────────────
// Environment Validation
// ─────────────────────────────────────────────────────────────

console.log("📋 Checking environment variables...");
const requiredEnvs = ["VITE_WORKER_BASE", "VITE_FIREBASE_URL"];
const missingEnvs = requiredEnvs.filter(env => !process.env[env] && !process.env.GITHUB_ACTIONS);

if (missingEnvs.length > 0) {
  console.error(`${colors.red}❌ Missing required local environment variables: ${missingEnvs.join(", ")}${colors.reset}`);
  console.error(`Ensure these are set in your terminal or .env file.`);
  process.exit(1);
}
console.log("✅ Environment validation passed.\n");

const today = new Date().toISOString().split("T")[0];

const branch =
  process.env.GITHUB_REF_NAME ||
  execSync("git rev-parse --abbrev-ref HEAD")
    .toString()
    .trim();

const hash = execSync("git rev-parse --short HEAD")
  .toString()
  .trim()
  ;

// ─────────────────────────────────────────────────────────────
// Security Audit
// ─────────────────────────────────────────────────────────────

console.log("🔍 Running Security Audit...");
run("npm", ["audit", "--audit-level=high"]);

console.log("✅ Security audit passed.\n");

// ─────────────────────────────────────────────────────────────
// Clean & Verify (Moved up to prevent version bumps on failure)
// ─────────────────────────────────────────────────────────────

console.log("🧹 Cleaning...");
run("npm", ["run", "clean"]);

console.log("✅ Clean completed.\n");

console.log("🧪 Running verification...");
run("npm", ["run", "verify"]);

console.log("✅ Verification passed.\n");

// ─────────────────────────────────────────────────────────────
// Update Version
// ─────────────────────────────────────────────────────────────

console.log("🔄 Updating version...");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const [major, minor, patch] = pkg.version
  .split(".")
  .map(Number);

const newVersion = `${major}.${minor}.${patch + 1}`;

pkg.version = newVersion;

fs.writeFileSync(
  "package.json",
  JSON.stringify(pkg, null, 2) + "\n"
);

run("npm", ["install", "--package-lock-only"]);

// ─────────────────────────────────────────────────────────────
// Branding Updates
// ─────────────────────────────────────────────────────────────

[
  "public/branding.json",
  "public/sheets.config.json",
  "public/translations.json",
].forEach((file) => {
  if (!fs.existsSync(file)) return;

  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));

    data.version = newVersion;
    data.lastUpdate = {
      ...(data.lastUpdate || {}),
      value: today,
    };
    data.lastCommitHash = hash;

    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2) + "\n"
    );
  } catch {
    console.log(`⚠️ Skipped invalid JSON: ${file}`);
  }
});

// ─────────────────────────────────────────────────────────────
// Service Worker Update
// ─────────────────────────────────────────────────────────────

if (fs.existsSync("public/sw.v2.js")) {
  try {
    let sw = fs.readFileSync("public/sw.v2.js", "utf8");

    sw = sw.replace(
      /const VERSION = "v.*";/,
      `const VERSION = "v${newVersion}";`
    );

    fs.writeFileSync("public/sw.v2.js", sw);

    console.log("✅ Service worker updated.");
  } catch {
    console.log("⚠️ Service worker update skipped.");
  }
}

console.log(`✅ Version updated to ${newVersion}\n`);

// ─────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────

console.log("🏗️ Building project...");
run("npm", ["run", "build"]);

if (!fs.existsSync("dist/index.html")) {
  console.error(`${colors.red}❌ Build failed: dist/index.html not found!${colors.reset}`);
  process.exit(1);
}

console.log("✅ Build completed.\n");

// ─────────────────────────────────────────────────────────────
// Git Commit
// ─────────────────────────────────────────────────────────────

console.log("📦 Preparing git commit...");

run("git", ["add", ".", '--', ':(exclude)**/.env*']);

const hasChanges =
  execSync("git diff --cached --name-only")
    .toString()
    .trim()
    .length > 0;

if (hasChanges) {
  const commitMsg = `deploy v${newVersion} [skip ci]`;

  console.log(`📝 Commit: ${commitMsg}`);

  run("git", ["commit", "-m", commitMsg]);

  run("git", ["tag", "-f", `v${newVersion}`]);

  console.log(`📤 Pushing to ${branch}...`);

  run("git", ["push", "origin", `HEAD:${branch}`]);

  run("git", ["push", "origin", `v${newVersion}`, "--force"]);

  console.log("✅ Git push completed.\n");
} else {
  console.log("ℹ️ No git changes detected.");
}