import fs from "fs";

const folders = [".build", "dist"];

for (const folder of folders) {
  if (fs.existsSync(folder)) {
    fs.rmSync(folder, { recursive: true, force: true });
    console.log("🧹 Cleaned:", folder);
  }
}

console.log("✅ Cleanup complete");