import { z } from "zod";

const appModeSchema = z.enum(["demo", "personal"]);

const liveConfigurationVariables = [
  "ALPACA_API_KEY_ID",
  "ALPACA_API_SECRET_KEY",
  "OPENROUTER_API_KEY",
  "TAVILY_API_KEY",
  "SEC_USER_AGENT",
] as const;

const personalRuntimeDatabaseVariables = ["DATABASE_URL"] as const;

export type AppMode = z.infer<typeof appModeSchema>;
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
  items: ConfigHealthItem[];
};

type Environment = Readonly<Record<string, string | undefined>>;

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function inspectCore(
  environment: Environment,
  parsedMode: ReturnType<typeof appModeSchema.safeParse>,
): ConfigHealthItem {
  const appUrl = environment.NEXT_PUBLIC_APP_URL;
  const hasInvalidUrl =
    hasValue(appUrl) && !z.url().safeParse(appUrl?.trim()).success;

  const problems = [
    ...(parsedMode.success ? [] : ["APP_MODE"]),
    ...(hasInvalidUrl ? ["NEXT_PUBLIC_APP_URL"] : []),
  ];

  return {
    id: "core",
    label: "Configuración base",
    status: problems.length === 0 ? "ready" : "degraded",
    message:
      problems.length === 0
        ? "El modo de ejecución y la URL pública son seguros."
        : "Hay valores inválidos; la aplicación usa el modo demo seguro.",
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
    status: missingVariables.length === 0 ? "ready" : "degraded",
    message:
      missingVariables.length === 0
        ? "La conexión pooled de runtime está configurada."
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
  const parsedMode = appModeSchema.safeParse(environment.APP_MODE ?? "demo");
  const mode = parsedMode.success ? parsedMode.data : "demo";

  return {
    mode,
    items: [
      inspectCore(environment, parsedMode),
      inspectDatabase(environment, mode),
      inspectLiveIntegrations(environment, mode),
    ],
  };
}
