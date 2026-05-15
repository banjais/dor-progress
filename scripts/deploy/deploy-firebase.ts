import { execSync } from "child_process";

console.log("🚀 Deploying Firebase Hosting...");

execSync("node --no-deprecation firebase deploy --only hosting --public .build", {
  stdio: "inherit",
});

console.log("✅ Firebase deployed successfully");