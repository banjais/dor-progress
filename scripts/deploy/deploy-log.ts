import fs from "fs";

const logFile = ".deploy-log.json";

const entry = {
  commit: process.env.GITHUB_SHA || "local",
  time: new Date().toISOString()
};

let logs = [];

if (fs.existsSync(logFile)) {
  logs = JSON.parse(fs.readFileSync(logFile, "utf-8"));
}

logs.unshift(entry);

fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));

console.log("📦 Deployment logged:", entry);