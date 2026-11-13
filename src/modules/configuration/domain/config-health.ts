import { z } from "zod";

import { parseTradingSecretKey } from "@/modules/trading/domain/trading-secret-key";

import { parseDatabaseTarget, sameDatabaseTarget } from "./database-target";

/**
 * Resolución del modo efectivo del runtime
 * ([ADR 0004](../../../../docs/architecture/adr/0004-personal-first-runtime.md),
 * que reemplaza el fallback a fixtures de la ADR 0002).
 *
 * El portal es de un solo owner y sirve datos reales. Sólo existen dos estados:
 *
 * - `personal`: el entorno declaró ser privado —local fuera de una plataforma de
 *   hosting, o `protected` en cualquier entorno detrás de la protección de la
 *   plataforma ([ADR 0008](../../../../docs/architecture/adr/0008-remote-personal-access.md))—
 *   y tiene una conexión pooled. Es el único que sirve datos.
 * - `locked`: **cualquier** otra situación. No sirve datos, no abre PostgreSQL y
 *   no consulta proveedores. No es una demo: es una negativa.
 *
 * El estado inseguro falla cerrado en vez de degradar a datos sintéticos. El
 * código de este repositorio es público y sus datos no: si un deployment no
 * puede probar que es privado, la respuesta correcta es no responder, no
 * inventar una versión publicable de la base del owner.
 */
const appModeSchema = z.enum(["locked", "personal"]);
const appRuntimeAccessSchema = z.enum(["public", "local", "protected"]);

/**
 * Variables de integraciones que el runtime todavía no consume. Se listan para
 * poder avisar que están configuradas y se ignoran, no porque su proveedor esté
 * adoptado: elegir el stack real es `F2-01`.
 */
const liveConfigurationVariables = [
  "ALPACA_API_KEY_ID",
  "ALPACA_API_SECRET_KEY",
  "OPENROUTER_API_KEY",
  "TAVILY_API_KEY",
  "INDEC_API_TOKEN",
  "SEC_USER_AGENT",
] as const;

const personalRuntimeDatabaseVariables = ["DATABASE_URL"] as const;

/**
 * La base de trading ([ADR 0076](../../../../docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md)).
 * No forma parte de la definición de `personal`: el resto del portal sirve
 * igual sin ella, y sólo la cuenta y el diario la necesitan.
 */
const TRADING_DATABASE_VARIABLE = "TRADING_DATABASE_URL";

/**
 * La conexión con Schwab (ADR 0076, secciones 5 y 6): la app, el callback
 * registrado y la clave del módulo. Como la base de trading, no forma parte de
 * `personal`.
 */
const SCHWAB_VARIABLES = [
  "SCHWAB_APP_KEY",
  "SCHWAB_APP_SECRET",
  "SCHWAB_CALLBACK_URL",
  "TRADING_SECRET_KEY",
] as const;

/** El path que la app de Schwab tiene registrado como callback. */
export const SCHWAB_CALLBACK_PATH = "/cuenta/schwab/callback";

export type AppMode = z.infer<typeof appModeSchema>;
export type AppRuntimeAccess = z.infer<typeof appRuntimeAccessSchema>;
export type ConfigStatus = "ready" | "degraded" | "disabled";

export type ConfigHealthItem = {
  id: "core" | "database" | "liveIntegrations" | "trading" | "schwab";
  label: string;
  status: ConfigStatus;
  message: string;
  missingVariables: string[];
};

export type ConfigHealth = {
  mode: AppMode;
  access: AppRuntimeAccess;
  items: ConfigHealthItem[];
};

type Environment = Readonly<Record<string, string | undefined>>;

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

type RuntimeResolution = {
  mode: AppMode;
  access: AppRuntimeAccess;
  problems: string[];
  /** `true` cuando se pidió `personal` y el entorno no pudo sostenerlo. */
  lockedByPolicy: boolean;
};

function resolveRuntime(environment: Environment): RuntimeResolution {
  // Sin `APP_MODE` declarado el runtime queda trabado. No hay default útil:
  // un entorno que no dice qué es no puede recibir datos del owner.
  const parsedMode = appModeSchema.safeParse(environment.APP_MODE ?? "locked");
  const hasExplicitAccess = hasValue(environment.APP_RUNTIME_ACCESS);
  const parsedAccess = appRuntimeAccessSchema.safeParse(
    environment.APP_RUNTIME_ACCESS ?? "public",
  );
  const requestedMode = parsedMode.success ? parsedMode.data : "locked";
  const access = parsedAccess.success ? parsedAccess.data : "public";
  const problems = new Set<string>();

  if (!parsedMode.success) {
    problems.add("APP_MODE");
  }

  if (!parsedAccess.success) {
    problems.add("APP_RUNTIME_ACCESS");
  }

  if (requestedMode === "personal") {
    if (!hasExplicitAccess || access === "public") {
      problems.add("APP_RUNTIME_ACCESS");
    }

    if (access === "local" && environment.VERCEL === "1") {
      problems.add("APP_RUNTIME_ACCESS");
    }

    // `protected` es una declaración del owner de que la URL está detrás de la
    // protección de la plataforma, y vale en cualquier entorno de hosting. La
    // aplicación no puede verificarla desde adentro y no la simula: aproximarla
    // con heurísticas de headers daría una garantía falsa (ADR 0008). El caso del
    // despliegue accidental —el repositorio es público— lo cubre la exigencia de
    // declaración explícita: sin `APP_MODE` el modo es `locked` y sin
    // `APP_RUNTIME_ACCESS` el acceso es `public`, que también traba.

    // La conexión pooled es parte de la definición de `personal`: sin ella el
    // modo no puede servir nada y quedaría en un estado intermedio que promete
    // datos y devuelve vacío.
    for (const name of personalRuntimeDatabaseVariables) {
      if (!hasValue(environment[name])) {
        problems.add(name);
      }
    }
  }

  const lockedByPolicy =
    !parsedMode.success || (requestedMode === "personal" && problems.size > 0);

  return {
    mode: lockedByPolicy ? "locked" : requestedMode,
    access,
    problems: [...problems],
    lockedByPolicy,
  };
}

function inspectCore(
  environment: Environment,
  runtime: RuntimeResolution,
): ConfigHealthItem {
  const appUrl = environment.NEXT_PUBLIC_APP_URL;
  const hasInvalidUrl =
    hasValue(appUrl) && !z.url().safeParse(appUrl?.trim()).success;

  const problems = [
    ...runtime.problems,
    ...(hasInvalidUrl ? ["NEXT_PUBLIC_APP_URL"] : []),
  ];

  if (runtime.lockedByPolicy) {
    return {
      id: "core",
      label: "Configuración base",
      status: "degraded",
      message:
        "El runtime no pudo probar que es privado; quedó trabado y no sirve datos.",
      missingVariables: problems,
    };
  }

  const healthyMessage =
    runtime.mode === "personal"
      ? "El modo personal está limitado al runtime local o protegido declarado."
      : "El runtime está trabado por declaración y no sirve datos.";

  return {
    id: "core",
    label: "Configuración base",
    status: problems.length === 0 ? "ready" : "degraded",
    message:
      problems.length === 0
        ? healthyMessage
        : "Hay valores de configuración inválidos que requieren revisión.",
    missingVariables: problems,
  };
}

function inspectDatabase(
  environment: Environment,
  runtime: RuntimeResolution,
): ConfigHealthItem {
  if (runtime.mode === "locked") {
    const missingVariables = personalRuntimeDatabaseVariables.filter(
      (name) => !hasValue(environment[name]),
    );

    return {
      id: "database",
      label: "Postgres",
      status: "disabled",
      message: runtime.lockedByPolicy
        ? "No se abre ninguna conexión mientras el runtime esté trabado."
        : "El runtime está trabado por declaración y no abre PostgreSQL.",
      missingVariables: [...missingVariables],
    };
  }

  return {
    id: "database",
    label: "Postgres",
    status: "ready",
    message:
      "Configurada para runtime pooled; este health no prueba conectividad.",
    missingVariables: [],
  };
}

function inspectLiveIntegrations(
  environment: Environment,
  mode: AppMode,
): ConfigHealthItem {
  const hasLiveConfiguration = liveConfigurationVariables.some((name) =>
    hasValue(environment[name]),
  );

  if (mode === "locked") {
    return {
      id: "liveIntegrations",
      label: "Integraciones live",
      status: hasLiveConfiguration ? "degraded" : "disabled",
      message: hasLiveConfiguration
        ? "Se detectó configuración live, pero un runtime trabado la ignora."
        : "Bloqueadas mientras el runtime esté trabado.",
      missingVariables: [],
    };
  }

  return {
    id: "liveIntegrations",
    label: "Integraciones live",
    status: "disabled",
    message: "Ninguna fuente está conectada todavía; se habilitan en Fase 2.",
    missingVariables: [],
  };
}

/**
 * Una base que falta es `disabled`, no `degraded`: el shell marca «requiere
 * atención» en todas las páginas ante un `degraded`, y que la cuenta no esté
 * configurada no le pide nada al resto del portal. `degraded` queda para una
 * configuración que está mal, no ausente.
 */
function inspectTrading(
  environment: Environment,
  runtime: RuntimeResolution,
): ConfigHealthItem {
  const label = "Base de trading";
  const tradingUrl = environment[TRADING_DATABASE_VARIABLE];
  const configured = hasValue(tradingUrl);

  if (runtime.mode === "locked") {
    return {
      id: "trading",
      label,
      status: "disabled",
      message: configured
        ? "Hay una base de trading configurada, pero un runtime trabado no la abre."
        : "Bloqueada mientras el runtime esté trabado.",
      missingVariables: [],
    };
  }

  // `TM-14`: Preview no recibe la base de trading. Su URL cambia en cada
  // deploy, así que tampoco coincidiría con un callback registrado en Schwab.
  if (environment.VERCEL_ENV === "preview") {
    return {
      id: "trading",
      label,
      status: configured ? "degraded" : "disabled",
      message: configured
        ? "Preview no debe recibir la base de trading; se ignora."
        : "Preview no recibe la base de trading.",
      missingVariables: configured ? [TRADING_DATABASE_VARIABLE] : [],
    };
  }

  if (!configured) {
    return {
      id: "trading",
      label,
      status: "disabled",
      message:
        "Sin su base, la cuenta y el diario no se ofrecen; el resto del portal no cambia.",
      missingVariables: [TRADING_DATABASE_VARIABLE],
    };
  }

  if (!parseDatabaseTarget(tradingUrl ?? "")) {
    return {
      id: "trading",
      label,
      status: "degraded",
      message: "El valor no es una URL de PostgreSQL con host y base.",
      missingVariables: [TRADING_DATABASE_VARIABLE],
    };
  }

  if (sameDatabaseTarget(tradingUrl ?? "", environment.DATABASE_URL ?? "")) {
    return {
      id: "trading",
      label,
      status: "degraded",
      message:
        "Apunta a la misma base que el análisis; la de trading tiene que ser otra.",
      missingVariables: [TRADING_DATABASE_VARIABLE],
    };
  }

  return {
    id: "trading",
    label,
    status: "ready",
    message:
      "Configurada para runtime pooled en una base aparte del análisis; este health no prueba conectividad.",
    missingVariables: [],
  };
}

function callbackProblem(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol !== "https:" ||
      url.pathname !== SCHWAB_CALLBACK_PATH ||
      url.search !== "" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== ""
    );
  } catch {
    return true;
  }
}

function inspectSchwab(
  environment: Environment,
  runtime: RuntimeResolution,
  trading: ConfigHealthItem,
): ConfigHealthItem {
  const label = "Conexión Schwab";
  const configured = SCHWAB_VARIABLES.filter((name) =>
    hasValue(environment[name]),
  );

  if (runtime.mode === "locked") {
    return {
      id: "schwab",
      label,
      status: "disabled",
      message:
        configured.length > 0
          ? "Hay credenciales de Schwab, pero un runtime trabado no las usa."
          : "Bloqueada mientras el runtime esté trabado.",
      missingVariables: [],
    };
  }

  // `TM-14`: el callback registrado no coincidiría con una URL de Preview.
  if (environment.VERCEL_ENV === "preview") {
    return {
      id: "schwab",
      label,
      status: configured.length > 0 ? "degraded" : "disabled",
      message:
        configured.length > 0
          ? "Preview no debe recibir credenciales de Schwab; se ignoran."
          : "Preview no recibe credenciales de Schwab.",
      missingVariables: [...configured],
    };
  }

  if (trading.status !== "ready") {
    return {
      id: "schwab",
      label,
      status: "disabled",
      message: "Necesita la base de trading, donde viven los tokens cifrados.",
      missingVariables: [],
    };
  }

  const missing = SCHWAB_VARIABLES.filter(
    (name) => !hasValue(environment[name]),
  );

  if (missing.length > 0) {
    return {
      id: "schwab",
      label,
      status: "disabled",
      message:
        "Sin la app de Schwab y la clave del módulo, la cuenta no se conecta.",
      missingVariables: [...missing],
    };
  }

  const invalid = [
    ...(/^[A-Za-z0-9]{16,64}$/u.test(environment.SCHWAB_APP_KEY?.trim() ?? "")
      ? []
      : ["SCHWAB_APP_KEY"]),
    ...(callbackProblem(environment.SCHWAB_CALLBACK_URL?.trim() ?? "")
      ? ["SCHWAB_CALLBACK_URL"]
      : []),
    ...(parseTradingSecretKey(environment.TRADING_SECRET_KEY).ok
      ? []
      : ["TRADING_SECRET_KEY"]),
  ];

  if (invalid.length > 0) {
    return {
      id: "schwab",
      label,
      status: "degraded",
      message: `Valores inválidos: el callback tiene que ser HTTPS a ${SCHWAB_CALLBACK_PATH} y la clave, 32 bytes en base64.`,
      missingVariables: invalid,
    };
  }

  return {
    id: "schwab",
    label,
    status: "ready",
    message:
      "Configurada; este health no prueba la conexión, que se ve en Cuenta.",
    missingVariables: [],
  };
}

export function getConfigHealth(environment: Environment): ConfigHealth {
  const runtime = resolveRuntime(environment);
  const trading = inspectTrading(environment, runtime);

  return {
    mode: runtime.mode,
    access: runtime.access,
    items: [
      inspectCore(environment, runtime),
      inspectDatabase(environment, runtime),
      inspectLiveIntegrations(environment, runtime.mode),
      trading,
      inspectSchwab(environment, runtime, trading),
    ],
  };
}

/**
 * Único predicado que autoriza leer datos. Las superficies preguntan por acá en
 * vez de comparar el modo a mano, para que agregar un estado futuro no deje una
 * ruta sirviendo datos por omisión.
 */
export function servesRealData(health: ConfigHealth): boolean {
  return health.mode === "personal";
}

/**
 * Único predicado que autoriza leer la base de trading: modo personal **y** su
 * base bien configurada. Las superficies de la cuenta preguntan por acá y, si
 * no, nombran la variable que falta (ADR 0076).
 */
export function servesSchwabConnection(health: ConfigHealth): boolean {
  return (
    servesTradingData(health) &&
    health.items.some((item) => item.id === "schwab" && item.status === "ready")
  );
}

export function servesTradingData(health: ConfigHealth): boolean {
  return (
    servesRealData(health) &&
    health.items.some(
      (item) => item.id === "trading" && item.status === "ready",
    )
  );
}
