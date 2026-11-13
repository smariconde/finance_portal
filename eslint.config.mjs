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
      // ADR 0076: el bloque de trading de más abajo repite estas reglas con las
      // suyas, porque una regla posterior reemplaza a la anterior.
      "src/server/db/trading/**",
      "src/server/persistence/trading/**",
      "tests/integration-trading/**",
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
          patterns: [
            {
              group: ["@/server/db/trading", "@/server/db/trading/*"],
              message:
                "La base de trading se compone sólo en src/server/persistence/trading (ADR 0076).",
            },
          ],
        },
      ],
    },
  },
  {
    // F5-02: ninguna ruta llega a un modelo. La primera superficie que lo haga
    // es una frontera nueva —Route Handler o Server Action— con su propio slice
    // y `TM-03` cerrado, no un import más (ADR 0033).
    files: ["src/app/**/*.ts", "src/app/**/*.tsx"],
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
          patterns: [
            {
              group: ["@/server/db/trading", "@/server/db/trading/*"],
              message:
                "La base de trading se compone sólo en src/server/persistence/trading (ADR 0076).",
            },
            {
              group: [
                "@/server/ai",
                "@/server/ai/*",
                "@/modules/ai/application/*",
              ],
              message:
                "Ninguna ruta llama a un modelo: el único camino es el worker de la corrida en src/server/jobs, después de responder (F6-13, ADR 0052). Otra superficie con IA es una frontera nueva con su propio slice y TM-03.",
            },
          ],
        },
      ],
    },
  },
  {
    // ADR 0076: la cuenta y el diario funcionan con la base de análisis caída.
    // El código de la base de trading no llega a su cliente, su schema ni sus
    // repositorios; cruzar una posición con su valuación se hace más arriba, y
    // es opcional.
    files: [
      "src/server/db/trading/**/*.ts",
      "src/server/persistence/trading/**/*.ts",
      // Prueban los almacenes de trading, como la integración de análisis
      // prueba los suyos; tampoco llegan a la base de análisis.
      "tests/integration-trading/**/*.ts",
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
            {
              name: "@/server/db/runtime-client",
              message: "La base de trading no abre la de análisis (ADR 0076).",
            },
            {
              name: "@/server/db/schema",
              message:
                "La base de trading no usa el schema de análisis (ADR 0076).",
            },
          ],
          patterns: [
            {
              group: [
                "@/server/db/postgres-*",
                "@/server/persistence/get-*",
                "../runtime-client",
                "../schema",
                "../postgres-*",
                "../get-*",
              ],
              message:
                "La base de trading no llega a la de análisis (ADR 0076).",
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
