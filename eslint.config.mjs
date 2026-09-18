import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Dos módulos que tienen que ser el único camino a algo, y su exención.
    // ESLint no permite exenciones por regla dentro de un bloque, así que las
    // dos restricciones viven juntas: que `decimal-policy.ts` pueda importar el
    // egress, o el egress `decimal.js`, no es un riesgo que nadie corra.
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [
      // ADR 0003: un solo constructor decimal configurado. Un segundo `Decimal`
      // con otra precisión redondearía distinto sin que nada falle.
      "src/modules/numeric/domain/decimal-policy.ts",
      // ADR 0020: toda salida pasa por el contador diario y el kill switch. Un
      // llamador que construya el cliente crudo tendría una puerta sin contador.
      "src/server/egress/**",
    ],
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
            {
              name: "@/server/egress/get-egress-client",
              message:
                "Usá getSourceEgressFetch de @/server/egress/get-source-egress-fetch (ADR 0020).",
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
