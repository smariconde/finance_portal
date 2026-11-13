import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import { selectTradingDependency } from "@/modules/configuration/domain/runtime-lock";
import { getTradingDatabase } from "@/server/db/trading/runtime-client";

/**
 * Raíz de composición de la base de trading (ADR 0076). Los repositorios de la
 * cuenta y el diario se construyen sobre esto; nada fuera de
 * `src/server/persistence/trading/` importa el cliente (ESLint lo cierra), y
 * nada acá importa el cliente de análisis.
 */
export function getTradingDatabaseConnection(): ReturnType<
  typeof getTradingDatabase
> {
  return selectTradingDependency(
    getConfigHealth(process.env),
    "trading-database",
    getTradingDatabase,
  );
}
