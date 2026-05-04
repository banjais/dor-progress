import { genkit, z, Genkit, GenerateResponse } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

/**
 * Singleton instance of Genkit to ensure efficient resource usage.
 */
let aiInstance: Genkit | null = null;

// Priority list of models for high-availability fallback logic
const FALLBACK_MODELS = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
];

const STRICT_SAFETY_SETTINGS = {
    safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_LOW_AND_ABOVE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_LOW_AND_ABOVE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_LOW_AND_ABOVE" },
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
        aiInstance = genkit({
            plugins: [googleAI({ apiKey })],
        });
    }
    return aiInstance;
}

/**
 * Type for generation options excluding the model, which is handled by the fallback logic.
 */
type GenerateFallbackOptions = Omit<Parameters<Genkit['generate']>[0], 'model'>;

/**
 * Internal helper to attempt generation across multiple models if one is down.
 */
async function generateWithFallback(ai: Genkit, options: GenerateFallbackOptions): Promise<GenerateResponse> {
    let lastError = null;
    // Try models in order of priority (anyone model should work)
    for (const modelId of FALLBACK_MODELS) {
        try {
            const response = await ai.generate({
                ...options,
                model: googleAI.model(modelId),
            });
            return response;
        } catch (err: unknown) {
            lastError = err;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Model ${modelId} failed. Attempting fallback...`, message);
            if (err && typeof err === 'object' && 'response' in err) {
                const status = (err as { response?: { status?: number } }).response?.status;
                if (status) console.error(`  HTTP Status: ${status}`);
            }
        }
    }
    throw lastError || new Error("All AI fallback models are unreachable.");
}

interface SummaryInput {
    rows: Record<string, any>[];
    mainSheet?: Record<string, any>;
    lang: "en" | "ne";
}

interface TranslationInput {
    text: string;
    targetLang: string;
}

const summaryOutputSchema = z.object({
    overallHealth: z.enum(["good", "moderate", "critical"]).describe("Overall health status of the projects."),
    criticalProjects: z.array(z.string()).describe("List of projects identified as critical or falling behind."),
    exceedingProjects: z.array(z.string()).describe("List of projects exceeding performance targets."),
    discrepancies: z.array(z.object({
        text: z.string().describe("Description of the variance."),
        severity: z.enum(["low", "medium", "high"]).describe("Impact level of this discrepancy.")
    })).describe("Specific gaps or variances between global departmental targets (from mainSheet) and current project progress (from rows)."),
    brief: z.string().describe("A concise executive briefing (under 100 words)."),
});

/**
 * Generates the executive summary briefing for the DoR MIS Dashboard.
 */
export async function runProjectSummary(apiKey: string, input: SummaryInput) {
    const ai = getAi(apiKey);
    if (!ai) throw new Error("Genkit not initialized. API Key required.");

    const summaryInputSchema = z.object({
        rows: z.array(z.record(z.any())),
        mainSheet: z.record(z.any()).optional(),
        lang: z.enum(["en", "ne"]).default("en"),
    });

    const generateProjectSummary = ai.defineFlow({
        name: "generateProjectSummary",
        inputSchema: summaryInputSchema,
        outputSchema: summaryOutputSchema,
    }, async (input: z.infer<typeof summaryInputSchema>): Promise<z.infer<typeof summaryOutputSchema>> => {
        let response = await generateWithFallback(ai, {
            prompt: `
        You are a world-class senior infrastructure analyst for the Department of Roads (DoR), Nepal.
        
        Global Context (Fiscal Year, Department Head, Overall Targets):
        ${input.mainSheet ? JSON.stringify(input.mainSheet) : "Standard MIS context."}

        Review the following project progress data:
        ${JSON.stringify(input.rows)}

        Your task is to generate a concise "Executive Briefing" and a categorized discrepancy analysis in ${input.lang === "ne" ? "Nepali" : "English"}.
        
        Guidelines:
        1. Discrepancy Analysis: Explicitly compare 'rows' progress against the 'Global Context' targets. Identify any significant variance. Assign a severity ('high' for critical delays/overruns, 'medium' for moderate lags, 'low' for minor variances).
        2. Identify the overall health of the road network projects, referencing global targets if available.
        3. Specifically call out any projects that are falling behind (critical status).
        4. Mention one or two projects that are exceeding performance targets.
        5. Use a professional, authoritative, and helpful tone.
        6. Keep the briefing under 100 words so it fits well in the UI.

        Output must be a JSON object matching the following structure:
        {
          "overallHealth": "good" | "moderate" | "critical",
          "criticalProjects": string[],
          "exceedingProjects": string[],
          "discrepancies": {"text": string, "severity": "low" | "medium" | "high"}[],
          "brief": string
        }
        Ensure all fields are present and correctly typed.
      `,
            config: {
                output: { schema: summaryOutputSchema },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                ],
            },
        });

        // Handle cases where the model blocked the response due to safety filters
        if (response.finishReason === 'blocked' || !response.output) {
            console.warn("Summary blocked by safety filters. Retrying with restrictive prompt...");

            // Retry with a minimalist, strictly factual prompt
            response = await generateWithFallback(ai, {
                prompt: `Summarize this infrastructure data into a JSON object with 'overallHealth', 'criticalProjects' (string array), 'exceedingProjects' (string array), 'discrepancies' (object array with 'text' and 'severity' fields), and a 'brief' string. 
                Be strictly factual. Do not use adjectives or evaluative language.
                Data: ${JSON.stringify({ config: input.mainSheet, rows: input.rows })}`,
                config: {
                    output: { schema: summaryOutputSchema },
                    temperature: 0.1,
                    ...STRICT_SAFETY_SETTINGS,
                },
            });
        }

        // If still blocked after retry, throw so the caller can use cached reports
        if (response.finishReason === 'blocked' || !response.output) {
            throw new Error("AI_SUMMARY_BLOCKED_AFTER_RETRY: Content triggered safety filters after retry.");
        }

        return response.output as z.infer<typeof summaryOutputSchema>;
    });

    return await generateProjectSummary(input);
}

/**
 * Translates text using Genkit.
 */
export async function runTranslation(apiKey: string, input: TranslationInput) {
    const ai = getAi(apiKey);
    if (!ai) throw new Error("Genkit not initialized. API Key required.");

    const translationInputSchema = z.object({
        text: z.string(),
        targetLang: z.string(),
    });

    const translateFlow = ai.defineFlow({
        name: "translateFlow",
        inputSchema: translationInputSchema,
        outputSchema: z.string(),
    }, async (input: z.infer<typeof translationInputSchema>): Promise<string> => {
        let response = await generateWithFallback(ai, {
            prompt: `Translate the following English text to ${input.targetLang === "ne" ? "Nepali (Devanagari script)" : input.targetLang}. 
        Preserve numbers, units (km, m, Nos), proper nouns, and technical terms. 
        Return ONLY the translated text with no additional commentary.

        Text: "${input.text}"

        Translation:`,
            config: {
                temperature: 0.2,
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                ],
            },
        });

        // If translation is blocked, return the original text so the UI doesn't break
        if (response.finishReason === 'blocked') {
            console.warn("Translation blocked. Retrying with direct command...");

            // Retry with a zero-context, direct translation command
            response = await generateWithFallback(ai, {
                prompt: `Translate to ${input.targetLang}: "${input.text}"`,
                config: {
                    temperature: 0.0,
                    ...STRICT_SAFETY_SETTINGS,
                },
            });
        }

        // Final check: throw so the Cloudflare Worker falls back to TRANSLATION_KV cache
        if (response.finishReason === 'blocked') {
            throw new Error("AI_TRANSLATION_BLOCKED_AFTER_RETRY: Safety filters triggered even after retry.");
        }

        return response.text as string;
    });

    return await translateFlow(input);
}