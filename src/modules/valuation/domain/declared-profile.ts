import { z } from "zod";

import { computeContentHash } from "@/modules/ingestion/domain/content-hash";
import { utcTimestampSchema } from "@/modules/temporal/domain/temporal-version";

import {
  profileEvidenceSchema,
  type ProfileEvidence,
} from "./method-selection";

/**
 * Perfil de ciclo declarado por el owner (`F6-43`, decisión delegada por el
 * owner el 2026-11-19 con MU medido).
 *
 * El ciclo se decide por SIC (`sec-sic-profile-2.0.0`), y el SIC 3674 junta a
 * quien diseña chips con quien fabrica memorias. Las memorias son un commodity
 * manufacturado: el resultado sigue al precio del DRAM y el NAND. Micron pasó de
 * −20 % de margen operativo en 2023 a 76 % ajustado en el ejercicio base, y el
 * camino de crecimiento sostenía ese pico: 4.202 por acción contra 705. Mover
 * el 3674 entero llevaría a NVDA o AVGO al método de ciclo, y una señal
 * automática de ciclicidad por márgenes necesita medirse sobre todo el
 * universo. La declaración es por CIK, con motivo, y **reemplaza** la evidencia
 * del SIC para ese perfil: dos evidencias de un perfil son un conflicto que el
 * selector no desempata. Un corte anterior a la declaración no la ve.
 */
export const DECLARED_PROFILE_RULE_VERSION = "owner-declared-profile-1.0.0";

export const profileDeclarationSchema = z.object({
  cik: z.string().regex(/^[0-9]{10}$/u),
  ticker: z.string().trim().min(1).max(12),
  profile: z.enum(["cyclical", "commodity"]),
  decidedBy: z.literal("owner"),
  declaredAt: utcTimestampSchema,
  rationale: z.string().trim().min(20).max(600),
});

export type ProfileDeclaration = z.infer<typeof profileDeclarationSchema>;

function visibleAt(
  instant: string,
  query: { readonly knownAt: string | null; readonly effectiveAt: string },
): boolean {
  return (
    (query.knownAt === null ||
      Date.parse(instant) <= Date.parse(query.knownAt)) &&
    Date.parse(instant) <= Date.parse(query.effectiveAt)
  );
}

/**
 * La evidencia con la declaración visible al corte: la del SIC para ese perfil
 * sale y entra la declarada. Sin declaración visible, la evidencia no cambia.
 */
export function applyProfileDeclarations(
  evidence: readonly ProfileEvidence[],
  declarations: readonly ProfileDeclaration[],
  subject: {
    readonly legalEntityId: string;
    readonly cik: string | null;
  },
  query: { readonly knownAt: string | null; readonly effectiveAt: string },
): readonly ProfileEvidence[] {
  const visible = declarations.filter(
    (item) => item.cik === subject.cik && visibleAt(item.declaredAt, query),
  );
  if (visible.length === 0) return evidence;
  const declared = new Set<string>(visible.map((item) => item.profile));
  return [
    ...evidence.filter((item) => !declared.has(item.profile)),
    ...visible.map((item) =>
      profileEvidenceSchema.parse({
        legalEntityId: subject.legalEntityId,
        profile: item.profile,
        present: true,
        rule: DECLARED_PROFILE_RULE_VERSION,
        derivation: "primary",
        validFrom: item.declaredAt,
        validTo: null,
        availableAt: item.declaredAt,
        supersededAt: null,
        recordedAt: item.declaredAt,
        sourceId: "owner-declaration",
        sourceDocumentId: null,
        contentHash: computeContentHash({
          rule: DECLARED_PROFILE_RULE_VERSION,
          declaration: item,
        }),
      }),
    ),
  ];
}
