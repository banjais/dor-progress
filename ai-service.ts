import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { z } from "zod";
import { ProjectRow, AiSummary, SummaryInput } from "./shared/types.js";
import aiPromptsData from "./ai-prompts.json" with { type: "json" };

/**
 * Singleton instance of Genkit to ensure efficient resource usage.
 */
let aiInstance: GoogleGenerativeAI | null = null;

// Priority list of models for high-availability fallback logic
const FALLBACK_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.0-pro",
];

const STRICT_SAFETY_SETTINGS = {
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
    },
  ],
};

/**
 * Resets the AI instance. Useful for testing different API keys
 * or clearing state between test runs.
 */
export function resetAi() {
  aiInstance = null;
}

export function getAi(apiKey: string) {
  if (!aiInstance && apiKey) {
    aiInstance = new GoogleGenerativeAI(apiKey);
  }
  return aiInstance;
}

/**
 * Type for generation options excluding the model, which is handled by the fallback logic.
 */

/**
 * Internal helper to attempt generation across multiple models if one is down.
 */
async function generateWithFallback(
  ai: GoogleGenerativeAI,
  options: any,
): Promise<any> {
  let lastError = null;
  for (const modelId of FALLBACK_MODELS) {
    try {
      const model = ai.getGenerativeModel({
        model: modelId,
        generationConfig: options.generationConfig,
        safetySettings: STRICT_SAFETY_SETTINGS.safetySettings
      });
      const result = await model.generateContent(options.prompt);
      const response = await result.response;
      const text = response.text();
      if (!text) throw new Error("Empty response from model");

      return { text, output: text, finishReason: "stop" };
    } catch (err: unknown) {
      lastError = err;
    }
  }
  throw lastError || new Error("All AI fallback models are unreachable.");
}

interface TranslationInput {
  text: string;
  targetLang: string;
}

const summaryOutputSchema = z.object({
  overallHealth: z
    .enum(["good", "moderate", "critical"])
    .describe("Overall health status of the projects."),
  criticalProjects: z
    .array(z.string())
    .describe("List of projects identified as critical or falling behind."),
  exceedingProjects: z
    .array(z.string())
    .describe("List of projects exceeding performance targets."),
  discrepancies: z
    .array(
      z.object({
        text: z.string().describe("Description of the variance."),
        severity: z
          .enum(["low", "medium", "high"])
          .describe("Impact level of this discrepancy."),
      }),
    )
    .describe(
      "Specific gaps or variances between global departmental targets (from mainSheet) and current project progress (from rows).",
    ),
  brief: z.string().describe("A concise executive briefing (under 100 words)."),
});

/**
 * Generates the executive summary briefing for the DoR MIS Dashboard.
 */
export async function runProjectSummary(apiKey: string, input: SummaryInput) {
  const ai = getAi(apiKey);
  if (!ai) throw new Error("Genkit not initialized. API Key required.");

  const projectData = JSON.stringify(input.rows.slice(0, 40));
  const lang = input.lang || "en";
  const promptTemplate = aiPromptsData.generateAiSummary[lang as keyof typeof aiPromptsData.generateAiSummary]
    || aiPromptsData.generateAiSummary.en;

  const prompt = promptTemplate.replace("{{projectData}}", projectData);
  const finalPrompt = input.mainSheet
    ? `Context: ${JSON.stringify(input.mainSheet)}\n\n${prompt} \n\nAssign status and identify discrepancies.`
    : prompt;

  const response = await generateWithFallback(ai, {
    prompt: `${finalPrompt}\n\nReturn the result as a raw JSON object matching the requested schema.`,
    generationConfig: {
      responseMimeType: "application/json",
    }
  });

  try {
    // Use the JSON mode output directly
    const parsed = JSON.parse(response.text);
    // Validate with Zod to ensure the AI output matches your expected types
    return summaryOutputSchema.parse(parsed);
  } catch (e) {
    console.error("AI Summary Parse Error:", e);
    console.debug("Raw AI Output:", response.text);
    throw new Error("Failed to parse AI summary JSON.");
  }
}

/**
 * Translates text using Genkit.
 */
export async function runTranslation(apiKey: string, input: TranslationInput) {
  const ai = getAi(apiKey);
  if (!ai) throw new Error("Genkit not initialized. API Key required.");

  const prompt = `Translate to ${input.targetLang === "ne" ? "Nepali (Devanagari)" : input.targetLang}: "${input.text}"
  Preserve units (km, m, Nos) and technical terms. Return ONLY the translation.`;

  const response = await generateWithFallback(ai, {
    prompt,
    generationConfig: {
      temperature: 0.1, // Lower temperature for more accurate translations
    }
  });
  return response.text.trim();
}
