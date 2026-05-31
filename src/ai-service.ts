import {
  GenerationConfig,
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  Part,
  SchemaType,
} from "@google/generative-ai";

import { z } from "zod";
import { type AiSummary, AiSummarySchema } from "@shared/api-shared";

/**
 * =========================
 * PROMPTS
 * =========================
 */
const AI_PROMPTS = {
  generateAiSummary: {
    en: "You are a world-class senior infrastructure analyst for the Department of Roads (DoR), Nepal. Analyze the provided project/road data and return structured insights strictly in JSON.",
    ne: "तपाईं नेपाल सडक विभाग (DoR) का एक वरिष्ठ पूर्वाधार विश्लेषक हुनुहुन्छ। दिइएको डाटाको आधारमा संरचित JSON मात्र फर्काउनुहोस्।",
  },
};

/**
 * =========================
 * MODEL FALLBACKS
 * =========================
 */
const FALLBACK_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-8b",
];

/**
 * =========================
 * SAFETY SETTINGS
 * =========================
 */
const STRICT_SAFETY_SETTINGS = {
  safetySettings: [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
    },
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
 * =========================
 * AI CLIENT (NO SINGLETON)
 * =========================
 */
export function getAi(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey);
}

/**
 * =========================
 * CORE GENERATION ENGINE
 * =========================
 */
async function generateWithFallback(
  ai: GoogleGenerativeAI,
  options: {
    parts?: Part[];
    prompt?: string;
    generationConfig?: GenerationConfig;
    systemInstruction?: string;
  },
): Promise<{ text: string; model: string }> {
  const contentParts: Part[] =
    options.parts ??
    (options.prompt !== undefined && options.prompt.trim() !== ""
      ? [{ text: options.prompt }]
      : []);

  if (contentParts.length === 0) {
    throw new Error("No content provided for AI generation");
  }

  let lastError: unknown;

  for (const modelId of FALLBACK_MODELS) {
    try {
      const model = ai.getGenerativeModel({
        model: modelId,
        generationConfig: options.generationConfig,
        safetySettings: STRICT_SAFETY_SETTINGS.safetySettings as any,
        systemInstruction: options.systemInstruction,
      });

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: contentParts,
          },
        ],
      });

      const text = result.response.text();

      if (text.trim() === "") {
        throw new Error("Empty response from model");
      }

      console.log({
        event: "ai_usage",
        model: modelId,
        status: "success",
      });

      return { text, model: modelId };
    } catch (err) {
      console.warn({
        event: "ai_usage",
        model: modelId,
        status: "fallback",
        error: err instanceof Error ? err.message : String(err),
      });

      lastError = err;
    }
  }

  throw lastError ?? new Error("All AI models failed");
}

/**
 * =========================
 * ZOD → GEMINI SCHEMA CONVERTER
 * =========================
 */
function zodToGeminiSchema(schema: z.ZodTypeAny): any {
  const def = (schema as any)._def;
  const result: any = {};

  if (schema.description !== undefined && schema.description !== "") {
    result.description = schema.description;
  }

  if (schema instanceof z.ZodObject) {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, subSchema] of Object.entries(schema.shape)) {
      properties[key] = zodToGeminiSchema(subSchema as z.ZodTypeAny);

      const isOptional =
        subSchema instanceof z.ZodOptional ||
        subSchema instanceof z.ZodNullable;

      if (!isOptional) required.push(key);
    }

    return {
      ...result,
      type: SchemaType.OBJECT,
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  if (schema instanceof z.ZodArray) {
    return {
      ...result,
      type: SchemaType.ARRAY,
      items: zodToGeminiSchema(schema.element),
    };
  }

  if (schema instanceof z.ZodEnum) {
    return {
      ...result,
      type: SchemaType.STRING,
      enum: def.values,
    };
  }

  if (schema instanceof z.ZodString) {
    return { ...result, type: SchemaType.STRING };
  }

  if (schema instanceof z.ZodNumber) {
    return { ...result, type: SchemaType.NUMBER };
  }

  if (schema instanceof z.ZodBoolean) {
    return { ...result, type: SchemaType.BOOLEAN };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToGeminiSchema(def.innerType);
  }

  if (schema instanceof z.ZodAny) {
    return { type: SchemaType.STRING };
  }

  return { type: SchemaType.STRING };
}

/**
 * =========================
 * SCHEMA INSTRUCTIONS GENERATOR
 * =========================
 */
function generateSchemaInstructions(schema: any, path = ""): string {
  if (schema.type === SchemaType.OBJECT && schema.properties !== undefined) {
    return Object.entries(schema.properties)
      .map(([key, sub]: [string, any]) => {
        const fullPath = path !== "" ? `${path}.${key}` : key;

        let line = `- ${fullPath}: ${
          sub.description ?? "No description provided."
        }`;

        if (Array.isArray(sub.enum)) {
          line += ` (Must be one of: ${sub.enum.join(", ")})`;
        }

        if (
          sub.type === SchemaType.OBJECT ||
          (sub.type === SchemaType.ARRAY &&
            sub.items?.type === SchemaType.OBJECT)
        ) {
          const nextSchema =
            sub.type === SchemaType.ARRAY ? sub.items : sub;

          const subInstructions = generateSchemaInstructions(
            nextSchema,
            fullPath,
          );

          if (subInstructions !== "") {
            line += `\n${subInstructions}`;
          }
        }

        return line;
      })
      .join("\n");
  }

  return "";
}

/**
 * =========================
 * AI SCHEMA
 * =========================
 */
const summaryResponseSchema = zodToGeminiSchema(AiSummarySchema);

summaryResponseSchema.description =
  "Structure for project progress summary and infrastructure analysis";

/**
 * =========================
 * PROJECT SUMMARY AI
 * =========================
 */
export async function runProjectSummary(
  apiKey: string,
  input: {
    rows?: any[];
    lang?: string;
    mainSheet?: any;
    pdfBase64?: string;
  },
): Promise<AiSummary> {
  const ai = getAi(apiKey);

  const lang = input.lang === "ne" ? "ne" : "en";

  const projectData =
    input.rows !== undefined && input.rows.length > 0
      ? JSON.stringify(input.rows.slice(0, 40))
      : "Raw PDF data provided";

  const promptTemplate = AI_PROMPTS.generateAiSummary[lang];

  const userPrompt = promptTemplate + "\n\nDATA:\n" + projectData;

  const schemaInstructions = generateSchemaInstructions(
    summaryResponseSchema,
  );

  const systemInstruction = `Return strictly valid JSON matching schema.

FIELD RULES:
${schemaInstructions}`;

  const contentParts: Part[] = [];

  if (input.mainSheet !== undefined) {
    contentParts.push({
      text:
        `System Context: ${JSON.stringify(input.mainSheet)}\n\n${userPrompt}`,
    });
  } else {
    contentParts.push({ text: userPrompt });
  }

  if (input.pdfBase64 !== undefined && input.pdfBase64 !== "") {
    contentParts.push({
      inlineData: {
        data: input.pdfBase64,
        mimeType: "application/pdf",
      },
    });
  }

  const response = await generateWithFallback(ai, {
    parts: contentParts,
    systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: summaryResponseSchema,
    },
  });

  const parsed = JSON.parse(response.text);

  return AiSummarySchema.parse({
    ...parsed,
    model: response.model,
  });
}

/**
 * =========================
 * TRANSLATION AI
 * =========================
 */
export async function runTranslation(
  apiKey: string,
  text: string,
  targetLang: string,
): Promise<string> {
  const ai = getAi(apiKey);

  const langLabel =
    targetLang === "ne" ? "Nepali (Devanagari)" : targetLang;

  const prompt = `Translate to ${langLabel}:

"${text}"

Rules:
- Preserve units (km, m, Nos)
- Preserve technical terms
- Output ONLY translation`;

  const response = await generateWithFallback(ai, {
    prompt,
    generationConfig: {
      temperature: 0.1,
    },
  });

  return response.text.trim();
}