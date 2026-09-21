import { z } from "zod";

import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type { Observation } from "../domain/observation";
import {
  addChainsToAudit,
  createAudit,
  summarizeAudit,
  type PointInTimeAuditReport,
  type SourceDocumentIndex,
} from "../domain/point-in-time-audit";

/**
 * Lectura del verificador del contrato point-in-time.
 *
 * Es una herramienta de operador y no una ruta: recorre la tabla entera, cosa
 * que el repositorio de la aplicación no hace y no debe hacer. Por eso la
 * lectura es propia y paginada, en vez de subirle el techo al repositorio
 * (`TM-07`).
 */
export const auditPageQuerySchema = z.object({
  /** Última cadena de la página anterior; `null` empieza por el principio. */
  after: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable()
    .default(null),
  /** Cadenas por página, no filas: una cadena se audita entera o no se audita. */
  limit: z.number().int().min(1).max(500).default(200),
});

export type AuditPageQuery = z.input<typeof auditPageQuerySchema>;

export type AuditChainPage = {
  readonly chains: readonly (readonly Observation[])[];
  /** Disponibilidad de los documentos que citan las filas de esta página. */
  readonly documents: SourceDocumentIndex;
  /** Última cadena leída, o `null` cuando no quedan más. */
  readonly cursor: string | null;
};

export interface PointInTimeAuditReader {
  readonly storage: "personal-postgres";
  readChainPage(query: AuditPageQuery): Promise<AuditChainPage>;
}

type ReaderFactories = {
  personal: () => PointInTimeAuditReader;
};

export function selectPointInTimeAuditReader(
  mode: AppMode,
  factories: ReaderFactories,
): PointInTimeAuditReader {
  return selectPersonalDependency(
    mode,
    "point-in-time-audit",
    factories.personal,
  );
}

/**
 * Recorre todas las cadenas publicadas y devuelve el informe. Una página que
 * vuelve vacía termina el recorrido; el cursor avanza por `revision_group_id`,
 * que es único y estable, así que ninguna cadena se lee dos veces ni se saltea.
 */
export async function runPointInTimeAudit(
  reader: PointInTimeAuditReader,
  options: {
    readonly pageSize?: number;
    readonly onPage?: (chains: number) => void;
  } = {},
): Promise<PointInTimeAuditReport> {
  let audit = createAudit();
  let after: string | null = null;

  for (;;) {
    const page: AuditChainPage = await reader.readChainPage({
      after,
      limit: options.pageSize ?? 200,
    });

    if (page.chains.length === 0) {
      break;
    }

    audit = addChainsToAudit(audit, page.chains, page.documents);
    options.onPage?.(audit.chains);

    if (page.cursor === null) {
      break;
    }

    after = page.cursor;
  }

  return summarizeAudit(audit);
}
