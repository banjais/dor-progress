import { GoogleGenerativeAI } from "@google/generative-ai";

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

/**
 * Structured Output Schema for Gemini
 */
const AiSummarySchema = {
  type: "object",
  properties: {
    brief: {
      type: "string",
      description: "A concise executive briefing under 100 words.",
    },
    overallHealth: {
      type: "string",
      enum: ["good", "moderate", "critical"],
    },
    criticalProjects: { type: "array", items: { type: "string" } },
    exceedingProjects: { type: "array", items: { type: "string" } },
    discrepancies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["text", "severity"],
      },
    },
    extractedData: {
      type: "object",
      properties: {
        headers: { type: "array", items: { type: "string" } },
        rows: {
          type: "array",
          items: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      required: ["headers", "rows"],
    },
  },
  required: ["brief"],
};

/** @type {GoogleGenerativeAI | null} */
let aiInstance = null;

export function getAi(apiKey) {
  if (!aiInstance && apiKey) {
    aiInstance = new GoogleGenerativeAI(apiKey);
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
  if (!ai) throw new Error("AI SDK not initialized. API Key required.");

  const model = ai.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: AiSummarySchema,
    },
  });

  return await generateProjectSummary(model, input);
}

/**
 * Flow logic defined as a helper to avoid re-registration.
 *
 * @param {any} model
 * @param {{pdfBase64: string, lang: 'en' | 'ne', mainSheet?: Record<string, any>}} input
 * @returns {Promise<AiSummary>}
 */
async function generateProjectSummary(model, input, maxRetries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const prompt = `
        You are a world-class senior infrastructure analyst for the Department of Roads (DoR), Nepal.
        Analyze the attached PDF project progress report.
        Global Context: ${input.mainSheet ? JSON.stringify(input.mainSheet) : "Standard MIS context."}

        Your task:
        1. Generate a concise "Executive Briefing" in ${input.lang === "ne" ? "Nepali" : "English"}.
        2. Identify overall health (good, moderate, or critical).
        3. Extract the full project progress table found in the document. 
        4. Identify key projects that are falling behind or exceeding targets.
        5. Identify data discrepancies.
        6. Keep the briefing under 100 words.
      `;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: "application/pdf",
            data: input.pdfBase64,
          },
        },
      ]);

      const response = await result.response;

      if (response.promptFeedback?.blockReason) {
        return {
          brief:
            "This summary was blocked by safety filters. Please ensure project data adheres to department guidelines.",
          overallHealth: "critical",
        };
      }

      return JSON.parse(response.text());
    } catch (e) {
      lastError = e;
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn(
        `[AI Attempt ${attempt + 1}] Generation failed: ${errorMessage}`,
      );
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
