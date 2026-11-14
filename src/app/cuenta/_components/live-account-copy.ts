import { formatAmount } from "@/modules/valuation/domain/display-format";

/**
 * Copia de la cuenta en vivo (`F11-04`): qué decirle al owner por cada código
 * cerrado que devuelve una lectura. Un código fuera del mapa se muestra como
 * falla genérica con su código, nunca se esconde.
 */
export type LiveFailureCopy = {
  readonly title: string;
  readonly text: string;
};

const EXACT: Record<string, LiveFailureCopy> = {
  not_connected: {
    title: "Sin acceso a la cuenta",
    text: "No hay un token vigente: la cuenta no está conectada, el login venció o la renovación falló. Reconectá desde la tarjeta de conexión.",
  },
  http_401: {
    title: "Schwab rechazó el token",
    text: "El acceso dejó de valer antes de su vencimiento. Reconectá la cuenta.",
  },
  http_429: {
    title: "Schwab pidió esperar",
    text: "Se superó su límite por minuto. La página vuelve a intentar en la próxima lectura.",
  },
  source_daily_budget_exhausted: {
    title: "Se agotó la cuota del día",
    text: "El tope diario de pedidos a Schwab se cumplió. Se repone a las 0 h UTC.",
  },
  source_source_disabled: {
    title: "Schwab está apagado",
    text: "El kill switch de la fuente está activo (`pnpm trading:sources`). No sale ningún pedido.",
  },
  source_budget_undeclared: {
    title: "La fuente no tiene tope declarado",
    text: "Sin tope diario no sale ningún pedido. Es un error de configuración del portal.",
  },
  account_type_not_measured: {
    title: "Cuenta de margen sin medir",
    text: "Schwab informa una cuenta MARGIN y sólo se midió la forma de una CASH. No se muestran saldos adivinados.",
  },
  multiple_accounts_not_measured: {
    title: "Más de una cuenta",
    text: "Schwab devolvió varias cuentas y el portal midió una. Falta decidir cuál se muestra.",
  },
  no_account: {
    title: "Sin cuentas",
    text: "Schwab no devolvió ninguna cuenta para este login.",
  },
};

export function liveFailureCopy(code: string): LiveFailureCopy {
  const exact = EXACT[code];
  if (exact !== undefined) return exact;
  if (code.endsWith("_schema_changed") || code.startsWith("position_")) {
    return {
      title: "Schwab cambió el formato",
      text: "La respuesta trae algo que el parser no conoce, así que la lectura quedó en cuarentena en vez de mostrarse a medias.",
    };
  }
  if (code.startsWith("egress_")) {
    return {
      title: "Schwab no respondió",
      text: "El pedido no se completó. La página vuelve a intentar en la próxima lectura.",
    };
  }
  return {
    title: "No se pudo leer la cuenta",
    text: "La lectura falló. La página vuelve a intentar en la próxima lectura.",
  };
}

/** Una cantidad con los decimales que trae, hasta cuatro: fracciones de acción. */
export function formatQuantity(value: string): string {
  const decimals = value.includes(".") ? value.split(".")[1]!.length : 0;
  return formatAmount(value, { scale: Math.min(decimals, 4) });
}

export function formatMoney(value: string): string {
  return formatAmount(value, { scale: 2 });
}

const TIME_ZONE = "America/Argentina/Buenos_Aires";

export function formatClock(instant: string): string {
  return new Date(instant).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  });
}

export function formatDateTime(instant: string): string {
  return new Date(instant).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  });
}

export const ORDER_STATUS_COPY: Record<string, string> = {
  WORKING: "Activa",
  PENDING_ACTIVATION: "Por activarse",
  QUEUED: "En cola",
  ACCEPTED: "Aceptada",
  NEW: "Nueva",
  AWAITING_PARENT_ORDER: "Espera a la madre",
  AWAITING_CONDITION: "Espera condición",
  AWAITING_STOP_CONDITION: "Espera el stop",
  AWAITING_MANUAL_REVIEW: "En revisión",
  AWAITING_UR_OUT: "Espera confirmación",
  AWAITING_RELEASE_TIME: "Espera su hora",
  PENDING_ACKNOWLEDGEMENT: "Sin confirmar",
  PENDING_CANCEL: "Cancelándose",
  PENDING_REPLACE: "Reemplazándose",
  PENDING_RECALL: "Retirándose",
};

export const INSTRUCTION_COPY: Record<string, string> = {
  BUY: "Compra",
  SELL: "Venta",
  BUY_TO_COVER: "Recompra",
  SELL_SHORT: "Venta en corto",
  BUY_TO_OPEN: "Compra para abrir",
  BUY_TO_CLOSE: "Compra para cerrar",
  SELL_TO_OPEN: "Venta para abrir",
  SELL_TO_CLOSE: "Venta para cerrar",
};

export const VALUATION_ABSENCE_COPY: Record<string, string> = {
  not_requested: "Sin valuar",
  no_run: "Sin corrida registrada",
  run_rejected: "Corrida rechazada",
  run_without_value: "Sin valor por acción",
};

export const SECTOR_ABSENCE_COPY: Record<string, string> = {
  never_classified: "Sin sector",
  not_effective_at_cutoff: "Sin sector vigente",
};

export const CEDEAR_ABSENCE_COPY: Record<string, string> = {
  no_program_recorded: "Sin CEDEAR registrado",
  not_effective_at_cutoff: "Sin programa vigente",
};

export const IDENTITY_ABSENCE_COPY: Record<string, string> = {
  not_in_universe: "Fuera del universo",
  ambiguous_symbol: "Ticker ambiguo",
};
