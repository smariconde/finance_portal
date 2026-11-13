import {
  servesTradingData,
  type AppMode,
  type ConfigHealth,
} from "./config-health";

/**
 * Negativa del runtime trabado
 * ([ADR 0004](../../../../docs/architecture/adr/0004-personal-first-runtime.md)).
 *
 * Un runtime que no pudo probar que es privado no recibe un repositorio
 * alternativo: no recibe ninguno. Antes existía un repositorio de fixtures que
 * cubría ese caso, y esa comodidad es justamente lo que hacía posible que una
 * ruta pareciera funcionar sin que nadie mirara en qué modo estaba corriendo.
 *
 * El error es de composición, no de request: se lanza al construir la
 * dependencia. Las superficies preguntan antes por `servesRealData()` y
 * renderizan su estado trabado, así que llegar hasta acá significa que una ruta
 * intentó leer datos sin declarar que podía.
 */
export class RuntimeLockedError extends Error {
  readonly resource: string;

  constructor(resource: string) {
    super(
      `The runtime is locked and cannot provide "${resource}". Personal mode requires a private runtime boundary and a pooled database.`,
    );
    this.name = "RuntimeLockedError";
    this.resource = resource;
  }
}

export function isRuntimeLockedError(
  error: unknown,
): error is RuntimeLockedError {
  return error instanceof RuntimeLockedError;
}

/**
 * Construye una dependencia sólo en modo personal. No hay rama alternativa a
 * propósito: agregar un modo nuevo obliga a decidir explícitamente si sirve
 * datos, en vez de heredarlo por un `else`.
 */
export function selectPersonalDependency<TDependency>(
  mode: AppMode,
  resource: string,
  createPersonal: () => TDependency,
): TDependency {
  if (mode !== "personal") {
    throw new RuntimeLockedError(resource);
  }

  return createPersonal();
}

/**
 * Negativa de la base de trading
 * ([ADR 0076](../../../../docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md)):
 * el runtime es personal pero la base de trading falta o está mal configurada.
 * Es otra negativa que la del runtime trabado: el resto del portal sirve igual.
 */
export class TradingUnavailableError extends Error {
  readonly resource: string;

  constructor(resource: string) {
    super(
      `The trading database is not configured and cannot provide "${resource}". The account needs TRADING_DATABASE_URL on its own database.`,
    );
    this.name = "TradingUnavailableError";
    this.resource = resource;
  }
}

export function isTradingUnavailableError(
  error: unknown,
): error is TradingUnavailableError {
  return error instanceof TradingUnavailableError;
}

/**
 * Construye una dependencia de la base de trading sólo si el runtime es
 * personal y esa base está lista. Un runtime trabado lanza `RuntimeLockedError`
 * antes de mirar la configuración de trading, como cualquier otra dependencia.
 */
export function selectTradingDependency<TDependency>(
  health: ConfigHealth,
  resource: string,
  createTrading: () => TDependency,
): TDependency {
  if (health.mode !== "personal") {
    throw new RuntimeLockedError(resource);
  }

  if (!servesTradingData(health)) {
    throw new TradingUnavailableError(resource);
  }

  return createTrading();
}
