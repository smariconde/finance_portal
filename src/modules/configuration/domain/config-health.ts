import { z } from "zod";

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
  "SEC_USER_AGENT",
] as const;

const personalRuntimeDatabaseVariables = ["DATABASE_URL"] as const;

export type AppMode = z.infer<typeof appModeSchema>;
export type AppRuntimeAccess = z.infer<typeof appRuntimeAccessSchema>;
export type ConfigStatus = "ready" | "degraded" | "disabled";

export type ConfigHealthItem = {
  id: "core" | "database" | "liveIntegrations";
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

export function getConfigHealth(environment: Environment): ConfigHealth {
  const runtime = resolveRuntime(environment);

  return {
    mode: runtime.mode,
    access: runtime.access,
    items: [
      inspectCore(environment, runtime),
      inspectDatabase(environment, runtime),
      inspectLiveIntegrations(environment, runtime.mode),
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
