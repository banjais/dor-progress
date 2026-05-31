import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

// Import the plugin

export default tseslint.config(
  {
    ignores: [
      "dist/",
      ".build/",
      "node_modules/",
      ".wrangler/",
      "functions/",
      ".netlify/",
      ".firebase/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Add the unused-imports plugin to this configuration object
    plugins: {
      "unused-imports": unusedImports,
    },
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.serviceWorker,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "error",
      // Disable the base @typescript-eslint rule for unused variables
      // This is necessary because the unused-imports plugin provides a more powerful, auto-fixable version.
      "@typescript-eslint/no-unused-vars": "off",
      // Enable the unused-imports rule for auto-fixing unused variables (including private methods)
      "unused-imports/no-unused-vars": [
        "warn", // You can change this to "error" if you want it to fail the build
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // Optional: Enable auto-fixing for unused imports as well
      "unused-imports/no-unused-imports": "error",
      "no-console": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        { allowString: false, allowNumber: false },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  {
    files: ["public/sw.v2.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.serviceWorker,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-console": "off",
    },
  },
  {
    files: ["shared/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.serviceWorker,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
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
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-console": "off",
    },
  },
  prettierConfig,
);
