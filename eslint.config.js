import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", ".build/", "node_modules/", ".wrangler/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021, ...globals.serviceWorker },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-console": "off",
    },
  },
  {
    files: ["public/sw.v2.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021, ...globals.serviceWorker },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-console": "off",
    },
  },
  {
    files: ["scripts/*.js", "src/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2021, console: true },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-console": "off",
    },
  },
  prettierConfig
);