import type { SecFiling } from "./parse-sec-submissions";
import { removeNewYorkOffset } from "./sec-acceptance-clock";

/**
 * Una presentación ya registrada no cambia de aceptación
 * ([ADR 0036](../../../../docs/architecture/adr/0036-sec-acceptance-clock.md),
 * enmienda del 2026-10-20).
 *
 * La aceptación de la SEC es un hecho inmutable, y `source_documents` nunca se
 * reescribe. Pero `sec-acceptance-clock-1.1.0` lee como sano un archivo corrido
 * cuando ninguna de sus aceptaciones cae fuera del horario de EDGAR —un filer
 * con pocas presentaciones, todas a media tarde—, y la ADR aceptó ese error
 * porque «sólo atrasa». En una **reingesta** no sólo atrasa: el filer nuevo de
 * ExxonMobil releyó el 10-Q de agosto cuatro horas tarde y la ingesta publicó
 * 89 revisiones con el mismo valor, contradiciendo al documento guardado.
 *
 * Por eso, antes de armar las vintages, cada presentación se contrasta con su
 * documento registrado:
 *
 * - igual: nada que hacer;
 * - distinta **exactamente por el offset de Nueva York**, en cualquier sentido:
 *   es el reloj de la SEC, no otra presentación, y vale la registrada (`kept`);
 * - distinta de cualquier otra forma: no hay cómo elegir y los hechos de esa
 *   accession se rechazan con nombre (`conflicting`).
 */
export const SEC_REGISTERED_ACCEPTANCE_VERSION =
  "sec-registered-acceptance-1.0.0";

/** Bandera de la corrida que conservó al menos una aceptación registrada. */
export const ACCEPTANCE_FROM_REGISTERED_DOCUMENT_FLAG =
  "acceptance_from_registered_document";

export type RegisteredAcceptances = {
  readonly filings: readonly SecFiling[];
  /** Accessions cuya aceptación se tomó del documento registrado. */
  readonly kept: readonly string[];
  /** Accessions que difieren del registro por algo que no es el offset. */
  readonly conflicting: readonly string[];
};

/** Pura. `registered` mapea accession → aceptación guardada (o `null`). */
export function reconcileRegisteredAcceptances(
  filings: readonly SecFiling[],
  registered: ReadonlyMap<string, string | null>,
): RegisteredAcceptances {
  const kept: string[] = [];
  const conflicting: string[] = [];

  const reconciled = filings.map((filing) => {
    if (!registered.has(filing.accessionNumber)) {
      return filing;
    }

    const stored = registered.get(filing.accessionNumber) ?? null;
    const read = filing.acceptedAt;

    if (stored === null || read === null) {
      if (stored !== read) {
        conflicting.push(filing.accessionNumber);
      }
      return filing;
    }

    // Por instante, no por texto: el registro y el archivo pueden escribir el
    // mismo instante con otra precisión.
    const storedMs = Date.parse(stored);
    const readMs = Date.parse(read);

    if (storedMs === readMs) {
      return filing;
    }

    if (
      storedMs === removeNewYorkOffset(readMs) ||
      readMs === removeNewYorkOffset(storedMs)
    ) {
      kept.push(filing.accessionNumber);
      return { ...filing, acceptedAt: new Date(storedMs).toISOString() };
    }

    conflicting.push(filing.accessionNumber);
    return filing;
  });

  return { filings: reconciled, kept, conflicting };
}
