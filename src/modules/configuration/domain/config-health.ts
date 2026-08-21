import { z } from "zod";

const appModeSchema = z.enum(["demo", "personal"]);
const appRuntimeAccessSchema = z.enum(["public", "local", "protected"]);

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
  usedSafeFallback: boolean;
};

function resolveRuntime(environment: Environment): RuntimeResolution {
  const parsedMode = appModeSchema.safeParse(environment.APP_MODE ?? "demo");
  const hasExplicitAccess = hasValue(environment.APP_RUNTIME_ACCESS);
  const parsedAccess = appRuntimeAccessSchema.safeParse(
    environment.APP_RUNTIME_ACCESS ?? "public",
  );
  const requestedMode = parsedMode.success ? parsedMode.data : "demo";
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

    const isProtectedPreview =
      access === "protected" &&
      environment.VERCEL === "1" &&
      environment.VERCEL_ENV === "preview";

    if (access === "protected" && !isProtectedPreview) {
      problems.add("VERCEL_ENV");
    }
  }

  const usedSafeFallback =
    !parsedMode.success || (requestedMode === "personal" && problems.size > 0);

  return {
    mode: usedSafeFallback ? "demo" : requestedMode,
    access,
    problems: [...problems],
    usedSafeFallback,
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

  const healthyMessage =
    runtime.mode === "personal"
      ? "El modo personal está limitado al runtime local o protegido declarado."
      : "El modo demo y su límite de exposición son seguros.";

  return {
    id: "core",
    label: "Configuración base",
    status: problems.length === 0 ? "ready" : "degraded",
    message:
      problems.length === 0
        ? healthyMessage
        : runtime.usedSafeFallback
          ? "La configuración solicitada no es segura; se aplicó el modo demo."
          : "Hay valores de configuración inválidos que requieren revisión.",
    missingVariables: problems,
  };
}

function inspectDatabase(
  environment: Environment,
  mode: AppMode,
): ConfigHealthItem {
  if (mode === "demo") {
    return {
      id: "database",
      label: "Postgres",
      status: "disabled",
      message: "No es necesario para el bootstrap en modo demo.",
      missingVariables: [],
    };
  }

  const missingVariables = personalRuntimeDatabaseVariables.filter(
    (name) => !hasValue(environment[name]),
  );

  return {
    id: "database",
    label: "Postgres",
    status: missingVariables.length === 0 ? "disabled" : "degraded",
    message:
      missingVariables.length === 0
        ? "La variable está presente, pero la persistencia se habilita recién en F1-02."
        : "El modo personal requiere una conexión pooled server-only.",
    missingVariables: [...missingVariables],
  };
}

function inspectLiveIntegrations(
  environment: Environment,
  mode: AppMode,
): ConfigHealthItem {
  const hasLiveConfiguration = liveConfigurationVariables.some((name) =>
    hasValue(environment[name]),
  );

  if (mode === "demo") {
    return {
      id: "liveIntegrations",
      label: "Integraciones live",
      status: hasLiveConfiguration ? "degraded" : "disabled",
      message: hasLiveConfiguration
        ? "Se detectó configuración live, pero el modo demo la ignora."
        : "Bloqueadas por el modo demo y por el roadmap.",
      missingVariables: [],
    };
  }

  return {
    id: "liveIntegrations",
    label: "Integraciones live",
    status: "disabled",
    message: "Planificadas para fases posteriores; ninguna API está conectada.",
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
      inspectDatabase(environment, runtime.mode),
      inspectLiveIntegrations(environment, runtime.mode),
    ],
  };
}
