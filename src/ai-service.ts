import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType, GenerationConfig, Part } from "@google/generative-ai";
import { z } from "zod";
import { AiSummary, AiSummarySchema } from "../shared/types.js";
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

async function generateWithFallback(ai: GoogleGenerativeAI, options: { parts?: (string | Part)[], prompt?: string, generationConfig?: GenerationConfig }) {
  const content = options.parts || options.prompt;
  if (!content) throw new Error("No content provided for AI generation");

  let lastError = null;
  for (const modelId of FALLBACK_MODELS) {
    try {
      const model = ai.getGenerativeModel({
        model: modelId,
        generationConfig: options.generationConfig,
        safetySettings: STRICT_SAFETY_SETTINGS.safetySettings as any,
      });
      const result = await model.generateContent(content);
      const text = result.response.text();
      if (!text) throw new Error("Empty response");
      return { text };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("All models failed");
}

/**
 * Converts a Zod schema into a Gemini-compatible ResponseSchema object.
 */
function zodToGeminiSchema(schema: z.ZodTypeAny): any {
  const def = (schema as any)._def;
  const result: any = {};

  if (schema.description) result.description = schema.description;

  if (schema instanceof z.ZodObject) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, subSchema] of Object.entries(schema.shape)) {
      properties[key] = zodToGeminiSchema(subSchema as z.ZodTypeAny);
      const isOptional = subSchema instanceof z.ZodOptional || subSchema instanceof z.ZodNullable;
      if (!isOptional) required.push(key);
    }
    return { ...result, type: SchemaType.OBJECT, properties, required: required.length ? required : undefined };
  }

  if (schema instanceof z.ZodArray) {
    return { ...result, type: SchemaType.ARRAY, items: zodToGeminiSchema(schema.element) };
  }

  if (schema instanceof z.ZodEnum) {
    return { ...result, type: SchemaType.STRING, enum: def.values };
  }

  if (schema instanceof z.ZodString) return { ...result, type: SchemaType.STRING };
  if (schema instanceof z.ZodNumber) return { ...result, type: SchemaType.NUMBER };
  if (schema instanceof z.ZodBoolean) return { ...result, type: SchemaType.BOOLEAN };
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToGeminiSchema(def.innerType);
  }
  if (schema instanceof z.ZodAny) return { ...result, type: SchemaType.OBJECT };

  return { ...result, type: SchemaType.STRING };
}

/**
 * Generates a human-readable explanation of the schema to help the AI 
 * understand the business logic and expectations for each field.
 */
function generateSchemaInstructions(schema: any, path = ""): string {
  if (schema.type === SchemaType.OBJECT && schema.properties) {
    return Object.entries(schema.properties)
      .map(([key, sub]: [string, any]) => {
        const fullPath = path ? `${path}.${key}` : key;
        let line = `- ${fullPath}: ${sub.description || "No description provided."}`;
        if (sub.enum) line += ` (Must be one of: ${sub.enum.join(", ")})`;
        if (sub.type === SchemaType.OBJECT || (sub.type === SchemaType.ARRAY && sub.items?.type === SchemaType.OBJECT)) {
          const nextSchema = sub.type === SchemaType.ARRAY ? sub.items : sub;
          const subInstructions = generateSchemaInstructions(nextSchema, fullPath);
          if (subInstructions) line += `\n${subInstructions}`;
        }
        return line;
      })
      .join("\n");
  }
  return "";
}

const summaryResponseSchema = zodToGeminiSchema(AiSummarySchema);
summaryResponseSchema.description = "Structure for project progress summary and data extraction";

export async function runProjectSummary(apiKey: string, input: { rows?: any[], lang?: string, mainSheet?: any, pdfBase64?: string }): Promise<AiSummary> {
  const ai = getAi(apiKey);
  if (!ai) throw new Error("AI not initialized");

  const projectData = input.rows ? JSON.stringify(input.rows.slice(0, 40)) : "Raw PDF data provided";
  const lang = input.lang || "en";

  const promptTemplate = (aiPromptsData.generateAiSummary as Record<string, string>)[lang] || aiPromptsData.generateAiSummary.en;
  const prompt = promptTemplate.replace("{{projectData}}", projectData);

  const finalPrompt = input.mainSheet
    ? `Context: ${JSON.stringify(input.mainSheet)}\n\n${prompt}`
    : prompt;

  const schemaInstructions = generateSchemaInstructions(summaryResponseSchema);
  const instructionBlock = `
FIELD REQUIREMENTS AND DEFINITIONS:
${schemaInstructions}

Return the result as a raw JSON object matching the schema.`;

  const contentParts: any[] = [{ text: `${finalPrompt}\n${instructionBlock}` }];

  // Support Multimodal input from worker.ts
  if (input.pdfBase64) {
    contentParts.push({
      inlineData: {
        data: input.pdfBase64,
        mimeType: "application/pdf"
      }
    });
  }

  const response = await generateWithFallback(ai, {
    parts: contentParts,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: summaryResponseSchema
    },
  });

  const parsed = JSON.parse(response.text);
  return AiSummarySchema.parse(parsed);
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
