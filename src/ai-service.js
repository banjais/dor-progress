// If Genkit continues to crash your Worker due to iconv-lite:
// Switch to the direct @google/generative-ai SDK which is Worker-compatible.
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

/**
 * @typedef {Record<string, string | number>} ProjectRow
 */

/**
 * @typedef {object} AiSummary
 * @property {string} brief
 * @property {"good" | "moderate" | "critical"} [overallHealth]
 * @property {string[]} [criticalProjects]
 * @property {string[]} [exceedingProjects]
 * @property {Array<{text: string, severity: "low" | "medium" | "high"}>} [discrepancies]
 * @property {object} [extractedData]
 * @property {string[]} extractedData.headers
 * @property {ProjectRow[]} extractedData.rows
 */

const AiSummarySchema = z.object({
  brief: z.string().describe("A concise executive briefing under 100 words."),
  overallHealth: z.enum(["good", "moderate", "critical"]).optional(),
  criticalProjects: z.array(z.string()).optional(),
  exceedingProjects: z.array(z.string()).optional(),
  discrepancies: z
    .array(
      z.object({
        text: z.string(),
        severity: z.enum(["low", "medium", "high"]),
      }),
    )
    .optional(),
  extractedData: z
    .object({
      headers: z.array(z.string()),
      rows: z.array(z.record(z.union([z.string(), z.number()]))),
    })
    .optional(),
});

/**
 * Helper to initialize Genkit with a specific API Key.
 * In Genkit v1, it's best to define the instance once.
 */
/** @type {import('genkit').Genkit | null} */
let aiInstance = null;

/**
 * @param {string} apiKey
 * @returns {import('genkit').Genkit | null}
 */
export function getAi(apiKey) {
  if (!aiInstance && apiKey) {
    aiInstance = genkit({
      plugins: [googleAI({ apiKey })],
    });
  }
  return aiInstance;
}

/**
 * Generates the executive summary briefing for the DoR MIS Dashboard.
 *
 * @param {string} apiKey
 * @param {{pdfBase64: string, lang: 'en' | 'ne', mainSheet?: Record<string, any>}} input
 * @returns {Promise<AiSummary>}
 */
export async function runProjectSummary(apiKey, input) {
  const ai = getAi(apiKey);
  if (!ai) throw new Error("Genkit not initialized. API Key required.");

  // Use the pre-defined flow
  return await generateProjectSummary(ai, input);
}

/**
 * Flow logic defined as a helper to avoid re-registration.
 *
 * @param {import('genkit').Genkit} ai
 * @param {{pdfBase64: string, lang: 'en' | 'ne', mainSheet?: Record<string, any>}} input
 * @returns {Promise<AiSummary>}
 */
async function generateProjectSummary(ai, input, maxRetries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.generate({
        model: googleAI.model("gemini-1.5-flash"),
        output: { schema: AiSummarySchema },
        prompt: [
          {
            text: `
            You are a world-class senior infrastructure analyst for the Department of Roads (DoR), Nepal.
            
            Analyze the attached PDF project progress report.
            Global Context: ${input.mainSheet ? JSON.stringify(input.mainSheet) : "Standard MIS context."}

            Your task:
            1. Generate a concise "Executive Briefing" in ${input.lang === "ne" ? "Nepali" : "English"}.
            2. Identify overall health (good, moderate, or critical).
            3. Extract the full project progress table found in the document. 
               - "headers" should be a clean list of column names.
               - "rows" should be an array of objects mapping header names to values.
            4. Identify key projects that are falling behind or exceeding targets.
            5. Identify data discrepancies.
            6. Keep the briefing under 100 words.
          `,
          },
          {
            media: {
              url: `data:application/pdf;base64,${input.pdfBase64}`,
            },
          },
        ],
      });

      if (response.finishReason === "blocked") {
        return {
          brief:
            "This summary was blocked by safety filters. Please ensure project data adheres to department guidelines.",
          overallHealth: "critical",
        };
      }

      // .output triggers the Zod validation and returns the structured data
      if (!response.output) {
        throw new Error("AI structured output was null or invalid.");
      }
      return response.output;
    } catch (e) {
      lastError = e;
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn(
        `[Genkit Attempt ${attempt + 1}] Validation or generation failed: ${errorMessage}`,
      );
      // Optional: Add jittered backoff here if desired
    }
  }

  console.error("[Genkit Final Failure]:", lastError);
  throw new Error(
    "AI Summary Generation failed after multiple validation attempts",
    {
      cause: lastError,
    },
  );
}
