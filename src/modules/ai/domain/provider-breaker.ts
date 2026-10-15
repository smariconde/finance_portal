/**
 * Breaker del proveedor
 * ([ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisión 4): tres fallas de transporte **seguidas** abren el circuito y
 * frenan la corrida.
 *
 * Vive lo que vive una corrida, como el presupuesto por proceso de la ADR 0020:
 * frenar la fuente para siempre es el kill switch, una decisión del owner. Lo
 * que cuenta es lo que no depende de la respuesta —no llegó, `429`, `5xx`—; una
 * respuesta que no valida es una falla del modelo y sube de escalón sin acercar
 * el breaker.
 */
export const PROVIDER_BREAKER_VERSION = "provider-breaker-1.0.0";

export const PROVIDER_BREAKER_THRESHOLD = 3;

export type ProviderBreaker = {
  readonly isOpen: () => boolean;
  readonly recordSuccess: () => void;
  readonly recordTransportFailure: () => void;
  readonly consecutiveFailures: () => number;
};

export function createProviderBreaker(
  threshold: number = PROVIDER_BREAKER_THRESHOLD,
): ProviderBreaker {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new RangeError("A breaker threshold is a positive integer.");
  }

  let failures = 0;

  return {
    isOpen: () => failures >= threshold,
    recordSuccess: () => {
      failures = 0;
    },
    recordTransportFailure: () => {
      failures += 1;
    },
    consecutiveFailures: () => failures,
  };
}
