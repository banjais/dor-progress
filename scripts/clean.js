import fs from "fs";
import path from "path";

const dirsToClean = [
  ".build",
  "dist",
  ".wrangler",
  ".firebase",
  "node_modules/.cache",
];

dirsToClean.forEach((dir) => {
  const fullPath = path.resolve(dir);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
    console.log(`✅ Cleaned ${dir}`);
  }
});
