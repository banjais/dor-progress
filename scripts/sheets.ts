import { sheetsConfig } from "../src/api-utils.js";

/**
 * Gets the configuration for a specific sheet by ID
 */
export function getSheetConfig(id: string) {
    return (sheetsConfig?.sheets || []).find((s: any) => s.id === id);
}
export const sheets = () => sheetsConfig?.sheets || [];