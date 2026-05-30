import { execSync } from "child_process";
import path from "path";

process.env.NODE_NO_WARNINGS = "1";

const colors = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

/**
 * Custom script to find and report only unused variables 
 * across the project using the existing ESLint configuration.
 */
function findUnused() {
  // Filter out internal script flags so they don't break the ESLint command
  const targets = process.argv.slice(2).filter(arg => !arg.startsWith("--")).join(" ") || ".";
  const isHook = process.argv.length > 2;
  const debugArgs = process.argv.includes("--debug-args");

  if (debugArgs) {
    console.log("Lint-staged targets:", process.argv.slice(2));
  }

  console.log(`${colors.bold}${colors.cyan}🔍 Scanning ${isHook ? "staged files" : "project"} for unused code...${colors.reset}\n`);

  try {
    const cmd = `npx eslint ${targets} --format json --no-warn-ignored`;
    let output;
    
    try {
      output = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
      // ESLint returns exit code 1 if it finds violations; stdout still contains the JSON
      output = error.stdout;
    }

    if (!output) {
      console.log(`${colors.red}❌ Failed to get linting results.${colors.reset}`);
      return;
    }

    const results = JSON.parse(output);
    let totalVarCount = 0;
    let deletedImportCount = 0;

    // First pass: Count imports that will be deleted
    results.forEach((report) => {
      const imports = report.messages.filter(m => m.ruleId === "unused-imports/no-unused-imports");
      deletedImportCount += imports.length;
    });

    // Perform the actual cleanup if there are imports to delete
    if (deletedImportCount > 0) {
      console.log(`${colors.cyan}🔨 Deleting ${deletedImportCount} unused import(s)...${colors.reset}`);
      // Execute the fix command on targets
      execSync(`npx eslint ${targets} --fix --no-warn-ignored`, { stdio: "ignore" });
      console.log(`${colors.green}✨ Cleanup complete.${colors.reset}\n`);
    }

    // Second pass: Report remaining variables
    results.forEach((report) => {
      const unusedVars = report.messages.filter(m => 
        m.ruleId === "unused-imports/no-unused-vars" || 
        m.ruleId === "@typescript-eslint/no-unused-vars"
      );

      if (unusedVars.length > 0) {
        const relativePath = path.relative(process.cwd(), report.filePath);
        console.log(`${colors.bold}${relativePath}${colors.reset}`);
        unusedVars.forEach(m => {
          totalVarCount++;
          console.log(`  ${colors.yellow}[Line ${m.line}:${m.column}]${colors.reset} ${m.message}`);
        });
        console.log();
      }
    });

    if (totalVarCount === 0 && deletedImportCount === 0) {
      console.log("✅ No unused code found!");
    } else {
      const summary = [];
      if (deletedImportCount > 0) summary.push(`${deletedImportCount} import(s) deleted`);
      if (totalVarCount > 0) summary.push(`${totalVarCount} variable(s) remaining`);
      
      console.log(`${colors.bold}${colors.cyan}Summary: ${summary.join(", ")}.${colors.reset}`);

      // If running as a hook, exit with error if variables remain
      if (totalVarCount > 0) {
        console.log(`${colors.red}❌ Please fix the unused variables above before committing.${colors.reset}`);
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(`${colors.red}Fatal Error:${colors.reset}`, err.message);
  }
}

findUnused();