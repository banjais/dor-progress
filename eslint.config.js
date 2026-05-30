import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

// 1. Define global ignores
const ignoreConfig = {
  ignores: [
      "dist/",
      ".build/",
      "node_modules/",
      ".wrangler/",
      "functions/",
      ".netlify/",
      ".firebase/",
  ],
};

// 2. Global Plugin and Resolver Configuration
const pluginConfig = {
  plugins: {
    "unused-imports": unusedImports,
    "import": importPlugin,
  },
  settings: {
    "import/resolver": {
      typescript: {
        alwaysTryTypes: true,
        project: ["./tsconfig.json", "./packages/*/tsconfig.json", "./src/tsconfig.worker.json"],
      },
    },
  },
};

// 3. Shared Rules applied to all JS and TS files
const sharedRules = {
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-require-imports": "error",
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      vars: "all",
      varsIgnorePattern: "^_",
      args: "after-used",
      argsIgnorePattern: "^_",
      caughtErrors: "none",
    },
  ],
  "unused-imports/no-unused-vars": "off",
  "unused-imports/no-unused-imports": "error",
  "no-console": "off",
};

// 4. Base TypeScript configuration
const baseTsConfig = {
  ...pluginConfig,
  files: ["**/*.ts"],
  rules: {
      ...sharedRules,

      // Enforce the use of 'satisfies' for object literal default exports
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration > ObjectExpression",
          message: "Object literals exported as default should use the 'satisfies' operator (e.g., 'export default { ... } satisfies Type') to ensure type safety while preserving the literal's inferred type.",
        },
      ],

      // Enforce Monorepo/Layer Boundaries
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              // Example: Prevent Worker code from importing build/deploy scripts
              target: "./src",
              from: "./scripts",
              message: "Worker source code cannot import from deployment scripts."
            },
            {
              // Monorepo template: Package A cannot import internal files from Package B
              target: "./packages/package-a",
              from: "./packages/package-b/src",
              message: "Always import from the public entry point of package-b, never its internal src folder."
            }
          ]
        }
      ],
      "import/no-relative-packages": "error", // Prevents ../../other-package imports

      // Automatic Import Sorting
      "import/order": [
        "error",
        {
          "groups": [
            "builtin",   // Node.js built-in modules (fs, path, etc.)
            "external",  // External npm packages (react, zod, etc.)
            "internal",  // Internal paths (aliased paths like @/)
            ["parent", "sibling"], // Relative paths (../ and ./)
            "index",     // index imports
            "object",    // Object imports
            "type"       // TypeScript type imports
          ],
          "pathGroups": [
            {
              "pattern": "react",
              "group": "external",
              "position": "before"
            },
            {
              "pattern": "**/*.{css,scss,sass,less,png,jpg,jpeg,svg,gif,webp,woff,woff2,ttf,eot}",
              "group": "type",
              "position": "after"
            },
            {
              "pattern": "@/debug-test/**",
              "group": "builtin",
              "position": "before"
            }
          ],
          "pathGroupsExcludedImportTypes": ["react"],
          "newlines-between": "always",
          "alphabetize": {
            "order": "asc",
            "caseInsensitive": true
          }
        }
      ]
  }
};

// 5. Define Environment-specific configs (Browser vs Node)
const browserGlobals = {
  languageOptions: {
    globals: { ...globals.browser, ...globals.es2021, ...globals.serviceWorker },
  },
};

const nodeGlobals = {
  languageOptions: {
    globals: { ...globals.node, ...globals.es2021, console: true },
  },
};

// 6. Compose the final configuration
export default tseslint.config(
  ignoreConfig,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ...baseTsConfig,
    ...browserGlobals,
  },
  {
    files: ["public/sw.v2.js"],
    ...pluginConfig,
    ...browserGlobals,
    rules: sharedRules,
  },
  {
    files: ["shared/**/*.js"],
    ...pluginConfig,
    ...browserGlobals,
    rules: sharedRules,
  },
  {
    files: ["scripts/*.js", "src/**/*.js"],
    ...pluginConfig,
    ...nodeGlobals,
    rules: sharedRules,
  },
  {
    // Disable import sorting for specific files
    files: ["src/legacy-imports.ts"], 
    rules: {
      "import/order": "off",
    },
  },
  prettierConfig,
);
