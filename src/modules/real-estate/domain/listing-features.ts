import { normalizedWords } from "./description-simhash";
import type { Condition, LegalFlag, PropertyType } from "./listing-capture";

/**
 * Estado y rasgos legales de un aviso (`listing-features-1.0.0`,
 * `docs/real-estate/market-model.md` §3). Se calculan **en el navegador**:
 * viaja el enum, nunca el texto.
 *
 * Dos fuentes, con la misma regla:
 *
 * - lo que el portal declara en un campo propio (Remax: `conditions[]`,
 *   `aptCredit`), que el adapter traduce a señales;
 * - el texto de la descripción y el título, normalizado como el SimHash
 *   (minúsculas, sin tildes, palabras `[a-z0-9]+`).
 *
 * Estado, con precedencia `to_renovate` > `new` > `good`: si algo dice «a
 * reciclar», el aviso es a reciclar aunque otra línea diga «excelente
 * ubicación». Un terreno o una cochera no tienen construcción que calificar:
 * `unknown`, siempre. Sin señales, `unknown`, nunca `good` por defecto.
 *
 * Un rasgo legal con «no» delante («no apto crédito») no cuenta.
 */
export const LISTING_FEATURES_VERSION = "listing-features-1.0.0";

export type ListingFeatureSignals = {
  readonly propertyType: PropertyType;
  /** Título y descripción tal como los publica el portal, o `null`. */
  readonly texts: readonly (string | null)[];
  /** Lo que el portal declara en un campo propio, ya traducido. */
  readonly portalConditions: readonly Exclude<Condition, "unknown">[];
  readonly portalLegalFlags: readonly LegalFlag[];
};

export type ListingFeatures = {
  readonly condition: Condition;
  readonly legalFlags: readonly LegalFlag[];
};

const WITHOUT_BUILDING: ReadonlySet<PropertyType> = new Set([
  "land",
  "parking",
]);

/** Frases sobre el texto normalizado: palabras separadas por un espacio. */
const CONDITION_PHRASES: readonly (readonly [
  Exclude<Condition, "unknown">,
  RegExp,
])[] = [
  [
    "to_renovate",
    /\b(a|para) (reciclar|refaccionar|remodelar|restaurar|refaccion)\b|\breciclaje\b|\bnecesita (arreglos|refaccion|mantenimiento)\b/u,
  ],
  ["new", /\ba estrenar\b|\bsin uso\b|\bnunca habitad[oa]\b/u],
  ["good", /\b(excelente|muy buen|buen|impecable) estado\b|\bimpecable\b/u],
];

const LEGAL_PHRASES: readonly (readonly [LegalFlag, RegExp])[] = [
  [
    "credit_eligible",
    /(?<!\bno )\bapt[oa] (a |para )?(credito|hipotecario|banco)\b/u,
  ],
  [
    "deed",
    /(?<!\bsin )\b(escriturad[oa]|con escritura|escritura (inmediata|al dia|perfecta|lista))\b/u,
  ],
  [
    "boleto_only",
    /\b(solo|unicamente) (con |por )?boleto\b|\bpor boleto\b|\bcon boleto( de compraventa)?\b(?! y escritura)/u,
  ],
  ["succession", /\bsucesion\b|\bsucesorio\b|\bdeclaratoria de herederos\b/u],
  [
    "possession",
    /\bderechos? posesorios?\b|\bposesion (veinteanal|treintanal)\b|\bboleto de posesion\b/u,
  ],
];

const CONDITION_ORDER: readonly Exclude<Condition, "unknown">[] = [
  "to_renovate",
  "new",
  "good",
];

export function listingFeatures(
  signals: ListingFeatureSignals,
): ListingFeatures {
  const text = signals.texts
    .filter((value): value is string => value !== null)
    .map((value) => normalizedWords(value).join(" "))
    .join(" . ");

  const conditions = new Set(signals.portalConditions);
  for (const [condition, phrase] of CONDITION_PHRASES) {
    if (phrase.test(text)) conditions.add(condition);
  }
  const condition: Condition = WITHOUT_BUILDING.has(signals.propertyType)
    ? "unknown"
    : (CONDITION_ORDER.find((candidate) => conditions.has(candidate)) ??
      "unknown");

  const flags = new Set(signals.portalLegalFlags);
  for (const [flag, phrase] of LEGAL_PHRASES) {
    if (phrase.test(text)) flags.add(flag);
  }
  // Escriturado y «sólo boleto» se contradicen: gana la escritura, que es lo
  // que el portal afirma; el boleto puede ser el paso previo que menciona.
  if (flags.has("deed")) flags.delete("boleto_only");

  return {
    condition,
    legalFlags: [...flags].sort(),
  };
}
