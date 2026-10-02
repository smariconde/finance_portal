import { computeContentHash } from "@/modules/ingestion/domain/content-hash";

import {
  profileEvidenceSchema,
  type ProfileEvidence,
  type SignalProfile,
} from "./method-selection";

/**
 * Señales de perfil desde el SIC que la SEC asigna al filer (`F3-01`).
 *
 * Los códigos salen de la
 * [lista SIC oficial de la SEC](https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list),
 * verificada el 2026-10-02. Son categorías publicadas, no umbrales.
 *
 * La 2.0.0 agrega lo que la 1.0.0 no hacía: **negativos** y los perfiles de
 * industria.
 *
 * - Un SIC **fuera de la división financiera** (6000–6799) es evidencia de que
 *   la empresa no es banco, aseguradora, REIT ni holding financiero. Uno
 *   **dentro** que no está mapeado —brokers, servicios financieros, planes
 *   médicos— no prueba nada sobre esos cuatro perfiles: quedan sin evidencia y
 *   el selector se abstiene.
 * - Holding no tiene regla positiva: la lista de la SEC no publica el 6719 de
 *   «offices of holding companies», y Loews o Berkshire figuran como
 *   aseguradoras. Sólo se descarta.
 * - Commodity y ciclo se deciden por industria, que es como Damodaran agrupa
 *   empresas: un SIC conocido fuera de las listas es evidencia negativa.
 */
export const SEC_SIC_PROFILE_RULE_VERSION = "sec-sic-profile-2.0.0";

const BANK_SIC = new Set(["6021", "6022", "6029", "6035", "6036"]);
const INSURER_SIC = new Set(["6311", "6321", "6331", "6351", "6361", "6399"]);
const REIT_SIC = new Set(["6798"]);

/**
 * Industrias extractivas cuyo resultado es el precio de lo que extraen o
 * refinan: la división B entera (minería, carbón, petróleo y gas y sus
 * servicios) y la refinación.
 */
const COMMODITY_SIC = new Set([
  "1000",
  "1040",
  "1090",
  "1220",
  "1221",
  "1311",
  "1381",
  "1382",
  "1389",
  "1400",
  "2911",
]);

/**
 * Bienes durables y de capital, acero y aluminio, transporte aéreo y marítimo y
 * construcción de viviendas: industrias cuya demanda sigue al ciclo económico,
 * donde el último año como run-rate es el error que el arquetipo prohíbe.
 */
const CYCLICAL_SIC = new Set([
  "1531",
  "3312",
  "3317",
  "3334",
  "3523",
  "3531",
  "3532",
  "3533",
  "3711",
  "3713",
  "3714",
  "3715",
  "3716",
  "3720",
  "3721",
  "4400",
  "4412",
  "4512",
  "4522",
]);

const FINANCE_PROFILES: readonly SignalProfile[] = [
  "bank",
  "insurer",
  "reit",
  "holding",
];

function isFinanceDivision(sic: string): boolean {
  const code = Number.parseInt(sic, 10);
  return code >= 6000 && code <= 6799;
}

export type SicProfileAssessment = Readonly<
  Partial<Record<SignalProfile, boolean>>
>;

/** La regla en sí: qué afirma un código sobre cada perfil, o nada. */
export function assessSicProfiles(sic: string): SicProfileAssessment {
  const assessment: Partial<Record<SignalProfile, boolean>> = {
    commodity: COMMODITY_SIC.has(sic),
    cyclical: CYCLICAL_SIC.has(sic),
  };

  const financeProfile = BANK_SIC.has(sic)
    ? "bank"
    : INSURER_SIC.has(sic)
      ? "insurer"
      : REIT_SIC.has(sic)
        ? "reit"
        : null;

  if (financeProfile !== null || !isFinanceDivision(sic)) {
    for (const profile of FINANCE_PROFILES) {
      assessment[profile] = profile === financeProfile;
    }
  }

  return assessment;
}

/** La aserción guardada de la que sale la evidencia, con su fecha. */
export type SicAssertion = {
  readonly legalEntityId: string;
  readonly sic: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly availableAt: string;
  readonly supersededAt: string | null;
  readonly recordedAt: string;
  readonly sourceId: string;
  readonly sourceDocumentId: string | null;
  readonly contentHash: string;
};

/**
 * Evidencia de perfil desde una aserción SIC. Hereda la vigencia y la
 * disponibilidad de la aserción: el SIC observado hoy no clasifica un corte
 * anterior a su primera captura.
 */
export function sicProfileEvidence(
  assertion: SicAssertion,
): readonly ProfileEvidence[] {
  const assessment = assessSicProfiles(assertion.sic);

  return Object.entries(assessment).map(([profile, present]) =>
    profileEvidenceSchema.parse({
      legalEntityId: assertion.legalEntityId,
      profile,
      present,
      rule: SEC_SIC_PROFILE_RULE_VERSION,
      derivation: "primary",
      validFrom: assertion.validFrom,
      validTo: assertion.validTo,
      availableAt: assertion.availableAt,
      supersededAt: assertion.supersededAt,
      recordedAt: assertion.recordedAt,
      sourceId: assertion.sourceId,
      sourceDocumentId: assertion.sourceDocumentId,
      contentHash: computeContentHash({
        rule: SEC_SIC_PROFILE_RULE_VERSION,
        assertion: assertion.contentHash,
        profile,
        present,
      }),
    }),
  );
}
