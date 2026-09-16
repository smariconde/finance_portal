import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // ADR 0003: un solo constructor decimal configurado. Un segundo `Decimal`
    // con otra precisión redondearía distinto sin que nada falle.
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["src/modules/numeric/domain/decimal-policy.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "decimal.js",
              message:
                "Usá src/modules/numeric/domain/decimal-policy.ts (ADR 0003).",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".agents/skills/**",
    ".next/**",
    "coverage/**",
    "out/**",
    "next-env.d.ts",
  ]),
]);
