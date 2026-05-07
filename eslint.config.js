import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  js.configs.recommended,
  {
    ignores: ["node_modules/", "dist/", ".build/", "public/", "VERSION"],
  },
  {
    files: ["**/*.{ts}"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.worker,
        ...globals.es2021,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/main.js"],
    languageOptions: {
      globals: {
        PDFLib: "readonly",
        appCheck: "writable",
        FIREBASE_APPCHECK_DEBUG_TOKEN: "writable",
        dashboard: "readonly",
      },
    },
  },
  {
    files: ["src/worker.js", "src/ai-service.ts", "src/ai-service.js"],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
  },
];
