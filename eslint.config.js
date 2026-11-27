import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const engineBoundary = [
  "react",
  "react-dom",
  "react/*",
  "three",
  "three/*",
  "@react-three/*",
  "@planet/renderer",
  "@planet/renderer/*",
  "@planet/explorer",
  "@planet/explorer/*",
];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["packages/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: engineBoundary,
              message: "engine must stay free of React, three.js, the renderer, and the explorer",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use the seeded PRNG so engine output stays deterministic.",
        },
        {
          object: "Date",
          property: "now",
          message: "Engine output must not depend on wall-clock time.",
        },
      ],
    },
  },
  {
    files: ["packages/renderer/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "react/*",
                "@react-three/*",
                "@planet/explorer",
                "@planet/explorer/*",
              ],
              message: "renderer must stay free of React and the explorer app",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/explorer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
