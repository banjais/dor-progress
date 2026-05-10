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

  if (apiBase.includes("workers.dev")) {
    console.warn(
      "⚠️  WARNING: Injecting a raw Cloudflare Worker URL into the Service Worker.",
    );
    console.warn("   Target: " + apiBase);
  }

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
  const envSha =
    process.env.GITHUB_SHA ||
    process.env.CI_COMMIT_SHA ||
    process.env.COMMIT_SHA;
  let commitSha = "unknown";
  if (envSha) {
    commitSha = envSha.substring(0, 7); // Use short SHA
  } else {
    try {
      commitSha = execSync("git rev-parse --short HEAD", {
        encoding: "utf8",
      }).trim();
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
  console.log(
    `   Build ID: ${buildId}, Commit: ${commitSha}, Version: ${versionIdentifier}`,
  );

  // --- Start of Inlining Logic for Embedded Single-File Support ---
  const indexHtmlPath = path.join(buildDir, "index.html");
  if (fs.existsSync(indexHtmlPath)) {
    let html = fs.readFileSync(indexHtmlPath, "utf8");

    // 1. Inline CSS
    const cssRegex =
      /<link rel="stylesheet" [^>]*href="\/assets\/([^"]+\.css)"[^>]*>/g;
    html = html.replace(cssRegex, (match, fileName) => {
      const cssPath = path.join(buildDir, "assets", fileName);
      if (fs.existsSync(cssPath)) {
        const cssContent = fs.readFileSync(cssPath, "utf8");
        return `<style>\n${cssContent}\n</style>`;
      }
      return match;
    });

    // 2. Inline JS (Module)
    // Note: This inlines the main entry script. For a truly single-file app,
    // all chunks would need to be merged, but since we use a simple dashboard,
    // this covers the primary case.
    const jsRegex = /<script [^>]*src="\/assets\/([^"]+\.js)"[^>]*><\/script>/g;
    html = html.replace(jsRegex, (match, fileName) => {
      const jsPath = path.join(buildDir, "assets", fileName);
      if (fs.existsSync(jsPath)) {
        const jsContent = fs.readFileSync(jsPath, "utf8");
        // We use a non-module script tag if we want maximum compatibility,
        // but since we rely on ES modules, we keep it as a module or strip the type.
        return `<script type="module">\n${jsContent}\n</script>`;
      }
      return match;
    });

    fs.writeFileSync(indexHtmlPath, html);
    console.log("🚀 index.html transformed into embedded single-file version");

    // 3. Inline Images (PNG/SVG) for true portability
    html = fs.readFileSync(indexHtmlPath, "utf8");
    const imgRegex = /src="\/([^"]+\.(png|svg|ico))"/g;
    const linkRegex = /href="\/([^"]+\.(png|svg|ico|json))"/g; // Also try to catch manifest/icons

    const inlineFile = (match, fileName) => {
      // Check both public and build directories
      const possiblePaths = [
        path.join(process.cwd(), "public", fileName),
        path.join(buildDir, fileName),
      ];

      for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
          const ext = path.extname(fileName).slice(1);
          const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
          const base64 = fs.readFileSync(filePath, "base64");
          console.log(`   📦 Inlined image: ${fileName}`);
          return match.startsWith("src=")
            ? `src="data:${mimeType};base64,${base64}"`
            : `href="data:${mimeType};base64,${base64}"`;
        }
      }
      return match;
    };

    html = html.replace(imgRegex, inlineFile);
    html = html.replace(linkRegex, inlineFile);

    fs.writeFileSync(indexHtmlPath, html);
    console.log("💎 Final index.html is now 100% portable (Images Inlined)");
  }
} else {
  console.warn("⚠️ sw.v2.js not found in .build");
}
