/**
 * Contrato del harness E2E (`F1-07`,
 * [ADR 0006](../../../docs/architecture/adr/0006-e2e-accessibility-harness.md)).
 *
 * Los dos servidores corren **el mismo build**. Lo único que los distingue es el
 * entorno del proceso, que es exactamente lo que la
 * [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md)
 * hizo decisivo: si el artefacto todavía horneara el modo, ambos puertos
 * responderían lo mismo y este gate no probaría nada.
 */
export const PERSONAL_PORT = 3110;
export const LOCKED_PORT = 3111;

export const PERSONAL_BASE_URL = `http://127.0.0.1:${PERSONAL_PORT}`;
export const LOCKED_BASE_URL = `http://127.0.0.1:${LOCKED_PORT}`;

/**
 * Valores centinela para `TM-02`.
 *
 * Se inyectan en **ambos** servidores. Ninguno puede aparecer en un body, en un
 * header ni en el payload RSC. Son sintéticos y no corresponden a ninguna
 * credencial real: el repositorio es público y nunca recibe una.
 */
export const SECRET_SENTINELS = {
  SEC_USER_AGENT: "sentinel-sec-user-agent-must-not-leak",
  ALPACA_API_KEY_ID: "sentinel-alpaca-key-id-must-not-leak",
  ALPACA_API_SECRET_KEY: "sentinel-alpaca-secret-must-not-leak",
  OPENROUTER_API_KEY: "sentinel-openrouter-key-must-not-leak",
  TAVILY_API_KEY: "sentinel-tavily-key-must-not-leak",
  CRON_SECRET: "sentinel-cron-secret-must-not-leak",
  DATABASE_DIRECT_URL:
    "postgresql://sentinel-direct-user:sentinel-direct-password@127.0.0.1:1/sentinel",
} as const;

export const SENTINEL_VALUES = Object.values(SECRET_SENTINELS);

/**
 * Apunta a un puerto donde no escucha nada, a propósito.
 *
 * `personal` exige una `DATABASE_URL` pooled para existir, pero ninguna
 * superficie de este slice consulta la base. Si alguna empezara a hacerlo, el
 * request fallaría en vez de pasar silenciosamente, así que "esta página no abre
 * PostgreSQL" queda como aserción del gate y no como afirmación de la
 * documentación.
 */
export const UNREACHABLE_DATABASE_URL =
  "postgresql://e2e:e2e@127.0.0.1:1/e2e-must-not-be-opened";

const SHARED_ENVIRONMENT = {
  NODE_ENV: "production",
  // Sin esto el servidor de Next reporta uso por red y el gate dejaría de poder
  // afirmar que no hay egress.
  NEXT_TELEMETRY_DISABLED: "1",
  ...SECRET_SENTINELS,
} as const;

/**
 * `@next/env` no pisa una variable que ya existe en `process.env`, así que estos
 * valores ganan sobre el `.env.local` del owner. La cadena vacía cuenta como
 * declarada y `hasValue()` la lee como ausente, que es la forma de *quitar* una
 * variable sin depender de que el archivo no exista.
 */
export const PERSONAL_ENVIRONMENT: Record<string, string> = {
  ...SHARED_ENVIRONMENT,
  APP_MODE: "personal",
  APP_RUNTIME_ACCESS: "local",
  DATABASE_URL: UNREACHABLE_DATABASE_URL,
  VERCEL: "",
  VERCEL_ENV: "",
};

export const LOCKED_ENVIRONMENT: Record<string, string> = {
  ...SHARED_ENVIRONMENT,
  APP_MODE: "locked",
  APP_RUNTIME_ACCESS: "public",
  DATABASE_URL: "",
  VERCEL: "",
  VERCEL_ENV: "",
};

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/** Las tres rutas que el portal sirve hoy, más la 404. */
export const ROUTES = {
  home: "/",
  configuration: "/configuracion",
  reference: "/valuacion/referencia",
  missing: "/ruta-que-no-existe",
} as const;
