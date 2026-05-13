import { execSync } from "child_process";

console.log("🚀 Deploying Firebase Hosting...");

execSync("firebase deploy --only hosting --public .build", {
  stdio: "inherit",
});

console.log("✅ Firebase deployed successfully");