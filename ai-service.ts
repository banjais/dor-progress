import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { z } from "zod";
import aiPromptsData from "./ai-prompts.json" with { type: "json" };

let aiInstance: GoogleGenerativeAI | null = null;

const FALLBACK_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.0-pro",
];

const STRICT_SAFETY_SETTINGS = {
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
  ],
};

export function getAi(apiKey: string) {
  if (!aiInstance && apiKey) {
    aiInstance = new GoogleGenerativeAI(apiKey);
  }
  return aiInstance;
}

async function generateWithFallback(ai: GoogleGenerativeAI, options: any) {
  let lastError = null;
  for (const modelId of FALLBACK_MODELS) {
    try {
      const model = ai.getGenerativeModel({
        model: modelId,
        generationConfig: options.generationConfig,
        safetySettings: STRICT_SAFETY_SETTINGS.safetySettings,
      });
      const result = await model.generateContent(options.prompt);
      const text = result.response.text();
      if (!text) throw new Error("Empty response");
      return { text };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("All models failed");
}

const summaryOutputSchema = z.object({
  overallHealth: z.enum(["good", "moderate", "critical"]),
  criticalProjects: z.array(z.string()),
  exceedingProjects: z.array(z.string()),
  discrepancies: z.array(z.object({
    text: z.string(),
    severity: z.enum(["low", "medium", "high"]),
  })),
  brief: z.string(),
});

export async function runProjectSummary(apiKey: string, input: any) {
  const ai = getAi(apiKey);
  if (!ai) throw new Error("AI not initialized");

  const projectData = JSON.stringify(input.rows?.slice(0, 40) || []);
  const lang = input.lang || "en";

  const promptTemplate = aiPromptsData.generateAiSummary[lang] || aiPromptsData.generateAiSummary.en;
  const prompt = promptTemplate.replace("{{projectData}}", projectData);

  const finalPrompt = input.mainSheet 
    ? `Context: ${JSON.stringify(input.mainSheet)}\n\n${prompt}` 
    : prompt;

  const response = await generateWithFallback(ai, {
    prompt: `${finalPrompt}\n\nReturn the result as a raw JSON object matching the schema.`,
    generationConfig: { responseMimeType: "application/json" },
  });

  const parsed = JSON.parse(response.text);
  return summaryOutputSchema.parse(parsed);
}

export async function runTranslation(apiKey: string, text: string, targetLang: string) {
  const ai = getAi(apiKey);
  if (!ai) throw new Error("AI not initialized");

  const prompt = `Translate to ${targetLang === "ne" ? "Nepali (Devanagari)" : targetLang}: "${text}"
Preserve units (km, m, Nos) and technical terms. Return ONLY the translation.`;

  const response = await generateWithFallback(ai, {
    prompt,
    generationConfig: { temperature: 0.1 },
  });

  return response.text.trim();
}