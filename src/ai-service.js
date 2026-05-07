import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

/**
 * @typedef {Record<string, string | number>} ProjectRow
 */

/**
 * @typedef {object} AiSummary
 * @property {string} brief
 */

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
 * @param {{rows: ProjectRow[], lang: 'en' | 'ne'}} input
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
 * @param {{rows: ProjectRow[], lang: 'en' | 'ne'}} input
 * @returns {Promise<AiSummary>}
 */
async function generateProjectSummary(ai, input) {
  try {
    const response = await ai.generate({
      model: googleAI.model("gemini-2.0-flash"),
      prompt: `
      You are a world-class senior infrastructure analyst for the Department of Roads (DoR), Nepal.
      Review the following project progress data:
      ${JSON.stringify(input.rows)}

      Your task is to generate a concise "Executive Briefing" in ${input.lang === "ne" ? "Nepali" : "English"}.

      Guidelines:
      1. Identify the overall health of the road network projects.
      2. Specifically call out any projects that are falling behind (critical status).
      3. Mention one or two projects that are exceeding performance targets.
      4. Use a professional, authoritative, and helpful tone.
      5. Keep the briefing under 100 words so it fits well in the UI.
    `,
    });

    if (response.finishReason === "blocked") {
      return {
        brief:
          "This summary was blocked by safety filters. Please ensure project data adheres to department guidelines.",
      };
    }
    return { brief: response.text };
  } catch (e) {
    console.error("[Genkit Flow Error]:", e);
    throw new Error("AI Summary Generation Failed", { cause: e });
  }
}
