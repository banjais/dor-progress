import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
    // 1. Global Ignores
    {
        ignores: ["dist", "node_modules", ".build", ".wrangler", ".firebase"],
    },

    // 2. Base Recommended Configs
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    // 3. Source Folder Configuration (Browser/Frontend)
    {
        files: ["src/**/*.ts", "src/**/*.tsx"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.serviceworker,
            },
            parserOptions: {
                // 'true' finds the closest tsconfig.json for each file (TS-ESLint v8+)
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "no-console": ["warn", { allow: ["error", "warn"] }],
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },

    // 4. Scripts Folder Configuration (Node.js/Utilities)
    {
        files: ["scripts/**/*.ts", "scripts/**/*.js", "scripts/**/*.mjs"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Scripts often need console.log for feedback
            "no-console": "off",
            // Allow requiring files or non-strict types in build scripts
            "@typescript-eslint/no-var-requires": "off",
            "@typescript-eslint/no-unused-vars": ["warn", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_"
            }],
        },
    },
);