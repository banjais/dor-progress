import js from "@eslint/js";
import globals from "globals";
import pluginN from "eslint-plugin-n";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
        ...globals.serviceworker,
        console: "readonly",
      },
    },
    plugins: {
      n: pluginN,
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "off",
      "no-undef": "error",
      "n/no-deprecated-api": "warn",
    },
  },
  {
    ignores: ["dist", ".build", "node_modules", "*.config.js"],
  },
];
