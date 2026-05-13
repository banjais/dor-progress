import { execSync } from "child_process";

const env = process.argv.includes("--env=staging") ||
            process.argv.includes("staging")
  ? "staging"
  : "production";

console.log(`🚀 Deploying Worker to ${env}...`);

if (env === "staging") {
  execSync("wrangler deploy --env staging", { stdio: "inherit" });
} else {
  execSync("wrangler deploy", { stdio: "inherit" });
}

console.log(`✅ Worker deployed to ${env}`);