import fs from "fs";
import path from "path";

const buildPath = path.resolve(".build");

if (!fs.existsSync(buildPath)) {
  console.error("❌ Build folder missing");
  process.exit(1);
}

const files = fs.readdirSync(buildPath);

if (files.length === 0) {
  console.error("❌ Build is empty");
  process.exit(1);
}

console.log("✅ Build verified:", files.length, "files");