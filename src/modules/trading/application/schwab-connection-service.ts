import { randomUUID } from "node:crypto";

import {
  createOAuthState,
  hashOAuthState,
  OAUTH_STATE_TTL_MS,
} from "@/modules/trading/domain/oauth-state";
import {
  accessNeedsRefresh,
  authorizationCodeForm,
  buildSchwabAuthorizeUrl,
  parseAuthorizationCode,
  parseSchwabTokenResponse,
  refreshExpiresAtFrom,
  refreshTokenForm,
  SchwabTokenResponseError,
} from "@/modules/trading/domain/schwab-oauth";
import {
  schwabConnectionStatus,
  type SchwabConnectionStatus,
} from "@/modules/trading/domain/schwab-connection-status";
import {
  openToken,
  sealToken,
  TOKEN_ENVELOPE_VERSION,
  TokenEnvelopeError,
} from "@/modules/trading/domain/token-envelope";

import type {
  SchwabConnectionEventKind,
  SchwabConnectionStore,
  StoredSchwabConnection,
} from "./schwab-connection-store";

/**
 * Conexión OAuth con Schwab (ADR 0076, sección 6), sin red ni base propias:
 * todo llega inyectado. Nunca devuelve ni registra un token, un código ni un
 * `state`: lo que sale de acá son códigos cerrados.
 */
export const SCHWAB_CONNECTION_SERVICE_VERSION = "schwab-connection-1.0.0";

/** Respuesta del endpoint de token tal como la entrega la puerta. */
export type SchwabTokenResponse = {
  readonly status: number;
  readonly body: Uint8Array;
};

export type SchwabConnectionDependencies = {
  readonly store: SchwabConnectionStore;
  /** Subclave `schwab-token-encryption` derivada de `TRADING_SECRET_KEY`. */
  readonly tokenKey: Buffer;
  /** `POST` al endpoint de token por la puerta (fuente `schwab-oauth`). */
  readonly requestToken: (form: Uint8Array) => Promise<SchwabTokenResponse>;
  /**
   * Códigos del gate de derechos de las fuentes de Schwab; vacío si puede
   * salir. Se pregunta antes de cada llamada: con la fila pendiente no sale
   * nada (`TM-15`).
   */
  readonly rightsBlockedBy: () => readonly string[];
  readonly now: () => string;
  readonly newId?: () => string;
  /** Espera inyectada para quien aguarda la renovación de otro request. */
  readonly sleep?: (ms: number) => Promise<void>;
};

export type SchwabConnectionStart =
  | {
      readonly outcome: "redirect";
      readonly authorizeUrl: string;
      /** Va a la cookie `httpOnly`; nunca a un log ni a la respuesta. */
      readonly state: string;
      readonly expiresAt: string;
    }
  | {
      readonly outcome: "rights_blocked";
      readonly blockedBy: readonly string[];
    };

export async function startSchwabConnection(
  dependencies: Pick<
    SchwabConnectionDependencies,
    "store" | "rightsBlockedBy" | "now"
  >,
  config: { readonly appKey: string; readonly callbackUrl: string },
): Promise<SchwabConnectionStart> {
  const blockedBy = dependencies.rightsBlockedBy();
  if (blockedBy.length > 0) return { outcome: "rights_blocked", blockedBy };

  const now = dependencies.now();
  const issued = createOAuthState();
  const expiresAt = new Date(
    Date.parse(now) + OAUTH_STATE_TTL_MS,
  ).toISOString();

  await dependencies.store.issueState({
    stateHash: issued.hash,
    createdAt: now,
    expiresAt,
  });

  return {
    outcome: "redirect",
    authorizeUrl: buildSchwabAuthorizeUrl({
      appKey: config.appKey,
      callbackUrl: config.callbackUrl,
      state: issued.state,
    }),
    state: issued.state,
    expiresAt,
  };
}

/** Lo que el callback le dice al owner, como código en la URL de `/cuenta`. */
export type SchwabCallbackOutcome =
  | "connected"
  | "denied"
  | "state_invalid"
  | "code_invalid"
  | "rights_blocked"
  | "exchange_failed";

export type SchwabCallbackInput = {
  readonly code: string | null;
  /** `error` del query: el owner canceló o Schwab negó el pedido. */
  readonly error: string | null;
  readonly state: string | null;
  readonly cookieState: string | null;
  readonly requestId: string;
};

async function record(
  dependencies: Pick<SchwabConnectionDependencies, "store" | "now" | "newId">,
  kind: SchwabConnectionEventKind,
  code: string,
  requestId: string | null,
): Promise<void> {
  await dependencies.store.recordEvent({
    eventId: (dependencies.newId ?? randomUUID)(),
    kind,
    code,
    requestId,
    occurredAt: dependencies.now(),
  });
}

function sameState(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.length === b.length && a === b;
}

/**
 * El callback: el `state` del query tiene que coincidir con el de la cookie y
 * con uno guardado, vigente y sin usar, y se consume aunque después falle el
 * canje. Recién entonces el código se cambia por tokens, que se guardan
 * sellados.
 */
export async function completeSchwabConnection(
  dependencies: SchwabConnectionDependencies,
  config: { readonly callbackUrl: string },
  input: SchwabCallbackInput,
): Promise<SchwabCallbackOutcome> {
  const stateHash = hashOAuthState(input.state);

  if (stateHash === null || !sameState(input.state, input.cookieState)) {
    await record(
      dependencies,
      "callback_rejected",
      "state_invalid",
      input.requestId,
    );
    return "state_invalid";
  }

  if (!(await dependencies.store.consumeState(stateHash, dependencies.now()))) {
    await record(
      dependencies,
      "callback_rejected",
      "state_invalid",
      input.requestId,
    );
    return "state_invalid";
  }

  if (input.error !== null) {
    await record(dependencies, "callback_rejected", "denied", input.requestId);
    return "denied";
  }

  const code = parseAuthorizationCode(input.code);

  if (code === null) {
    await record(
      dependencies,
      "callback_rejected",
      "code_invalid",
      input.requestId,
    );
    return "code_invalid";
  }

  if (dependencies.rightsBlockedBy().length > 0) {
    await record(
      dependencies,
      "callback_rejected",
      "rights_blocked",
      input.requestId,
    );
    return "rights_blocked";
  }

  const failure = await exchangeOrFailure(dependencies, config, code);

  if (typeof failure === "string") {
    await record(dependencies, "exchange_failed", failure, input.requestId);
    return "exchange_failed";
  }

  await record(dependencies, "connected", "connected", input.requestId);
  return "connected";
}

async function exchangeOrFailure(
  dependencies: SchwabConnectionDependencies,
  config: { readonly callbackUrl: string },
  code: string,
): Promise<string | { readonly ok: true }> {
  let response: SchwabTokenResponse;

  try {
    response = await dependencies.requestToken(
      authorizationCodeForm({ code, callbackUrl: config.callbackUrl }),
    );
  } catch (error) {
    return failureCode(error);
  }

  if (response.status !== 200) return `http_${response.status}`;

  const receivedAt = dependencies.now();

  try {
    const grant = parseSchwabTokenResponse(response.body, receivedAt);

    await dependencies.store.saveConnection({
      accessEnvelope: sealToken(
        dependencies.tokenKey,
        "access",
        grant.accessToken,
      ),
      accessExpiresAt: grant.accessExpiresAt,
      refreshEnvelope: sealToken(
        dependencies.tokenKey,
        "refresh",
        grant.refreshToken,
      ),
      authorizedAt: receivedAt,
      refreshExpiresAt: refreshExpiresAtFrom(receivedAt),
      envelopeVersion: TOKEN_ENVELOPE_VERSION,
      updatedAt: receivedAt,
    });
  } catch (error) {
    return failureCode(error);
  }

  return { ok: true };
}

/** Un código cerrado para el log; nunca el mensaje, que podría citar algo. */
function failureCode(error: unknown): string {
  if (error instanceof SchwabTokenResponseError) return `token_${error.code}`;
  if (error instanceof TokenEnvelopeError) return `envelope_${error.code}`;
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    if (/^[a-z0-9_]{1,48}$/u.test(code)) return `egress_${code}`;
  }
  return "unexpected";
}

/**
 * El access token para la puerta: descifrado y, si le queda menos de un minuto,
 * renovado bajo lock. `undefined` si no hay conexión, si venció el refresh o si
 * la renovación falló: la puerta lo rechaza como `credential_missing` y nada
 * sale con un token viejo.
 */
export async function provideSchwabAccessToken(
  dependencies: SchwabConnectionDependencies,
): Promise<string | undefined> {
  try {
    return await provideUnderLock(dependencies);
  } catch (error) {
    // Un access token que no abre —otra clave, una fila alterada— no es un
    // token: se registra y la puerta se niega, sin citar nada del sobre.
    if (!(error instanceof TokenEnvelopeError)) throw error;
    await record(dependencies, "refresh_failed", failureCode(error), null);
    return undefined;
  }
}

/** Cuánto dura un reclamo de renovación: más que el deadline de la puerta. */
const REFRESH_CLAIM_MS = 30_000;
/** Quien no tiene el reclamo espera releyendo, hasta 5 segundos. */
const REFRESH_WAIT_STEP_MS = 250;
const REFRESH_WAIT_STEPS = 20;

async function provideUnderLock(
  dependencies: SchwabConnectionDependencies,
): Promise<string | undefined> {
  const sleep =
    dependencies.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let step = 0; step <= REFRESH_WAIT_STEPS; step += 1) {
    const current = await dependencies.store.readConnection();
    if (current === null) return undefined;

    const now = dependencies.now();

    if (Date.parse(now) >= Date.parse(current.refreshExpiresAt)) {
      return undefined;
    }

    if (!accessNeedsRefresh(current.accessExpiresAt, now)) {
      return openToken(dependencies.tokenKey, "access", current.accessEnvelope);
    }

    if (dependencies.rightsBlockedBy().length > 0) return undefined;

    const claimedUntil = new Date(
      Date.parse(now) + REFRESH_CLAIM_MS,
    ).toISOString();
    const claimed = await dependencies.store.claimRefresh(now, claimedUntil);

    if (claimed !== null) return renew(dependencies, claimed, claimedUntil);

    // Otro request la está renovando: se espera a que escriba el token nuevo.
    if (step < REFRESH_WAIT_STEPS) await sleep(REFRESH_WAIT_STEP_MS);
  }

  return undefined;
}

async function renew(
  dependencies: SchwabConnectionDependencies,
  current: StoredSchwabConnection,
  claimedUntil: string,
): Promise<string | undefined> {
  const failed = async (code: string) => {
    await dependencies.store.releaseRefresh(claimedUntil);
    await record(dependencies, "refresh_failed", code, null);
    return undefined;
  };

  let refreshToken: string;
  try {
    refreshToken = openToken(
      dependencies.tokenKey,
      "refresh",
      current.refreshEnvelope,
    );
  } catch (error) {
    return failed(failureCode(error));
  }

  let response: SchwabTokenResponse;
  try {
    response = await dependencies.requestToken(refreshTokenForm(refreshToken));
  } catch (error) {
    return failed(failureCode(error));
  }

  if (response.status !== 200) return failed(`http_${response.status}`);

  const receivedAt = dependencies.now();
  let grant;
  try {
    grant = parseSchwabTokenResponse(response.body, receivedAt);
  } catch (error) {
    return failed(failureCode(error));
  }

  const written = await dependencies.store.completeRefresh(claimedUntil, {
    accessEnvelope: sealToken(
      dependencies.tokenKey,
      "access",
      grant.accessToken,
    ),
    accessExpiresAt: grant.accessExpiresAt,
    // Si Schwab entrega otro refresh token, reemplaza al anterior; su
    // vencimiento sigue siendo el del login (`schwab-refresh-lifetime-1.0.0`).
    refreshEnvelope: sealToken(
      dependencies.tokenKey,
      "refresh",
      grant.refreshToken,
    ),
    updatedAt: receivedAt,
  });

  await record(
    dependencies,
    "access_refreshed",
    written ? "access_refreshed" : "access_refreshed_claim_lost",
    null,
  );

  // Aunque haya perdido el reclamo, el token que Schwab acaba de entregar vale.
  return grant.accessToken;
}

export async function readSchwabConnectionStatus(
  dependencies: Pick<SchwabConnectionDependencies, "store" | "now">,
): Promise<SchwabConnectionStatus> {
  const connection = await dependencies.store.readConnection();

  return schwabConnectionStatus(
    connection === null
      ? null
      : {
          connectedAt: connection.authorizedAt,
          refreshExpiresAt: connection.refreshExpiresAt,
        },
    dependencies.now(),
  );
}
