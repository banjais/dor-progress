import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import nPlugin from "eslint-plugin-n";
import prettierConfig from "eslint-config-prettier";
import { fixupPluginRules } from "@eslint/compat";

export default tseslint.config(
  // 1. Global ignores (Replaces .eslintignore)
  {
    ignores: [
      "dist/",
      ".build/",
      "node_modules/",
      "public/",
      ".wrangler/",
      ".firebase/",
      ".agents/",
      ".kilo/",
      ".qwen/",
      "VERSION",
      "src/**/*.js",
    ],
  },

  // 2. JS Recommended for all JS/TS files
  js.configs.recommended,

  // 3. Source Folder Configuration (Browser/Frontend)
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "index.ts", "ai-service.ts"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    plugins: {
      react: fixupPluginRules(reactPlugin),
      "react-hooks": fixupPluginRules(reactHooksPlugin),
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.es2021,
        PDFLib: "readonly",
        appCheck: "writable",
        FIREBASE_APPCHECK_DEBUG_TOKEN: "writable",
        dashboard: "readonly",
      },
      parserOptions: {
        project: ["./tsconfig.json", "./src/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: {
        version: "18.3",
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false,
        },
      ],
      // Disable noisy type-checked rules that depend on strictNullChecks
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },

  // 4. Scripts Folder Configuration (Node.js/Utilities)
  {
    files: ["scripts/**/*.{js,mjs,ts}"],
    extends: [
      ...tseslint.configs.recommended, // Don't use type-checked rules for scripts to avoid noise
    ],
    plugins: {
      n: nPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...nPlugin.configs.recommended.rules,
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // 5. Prettier (Must be last)
  prettierConfig,
);



