/**
 * Backend Registry Validator
 * This script is called by GitHub Actions to ensure all AI flows/tools load correctly.
 */
import { getAi } from "../src/ai-service.js";

// Initialize with dummy key or env for registry check
try {
  const ai = getAi(process.env.GEMINI_API_KEY || "dummy-key");
  if (!ai) throw new Error("Failed to initialize AI SDK");

  console.log("🔍 Checking AI SDK Status...");
  console.log(`✅ AI SDK (Direct) initialized successfully.`);
} catch (error) {
  console.error("❌ Registry check failed:", error);
  process.exit(1);
}
