/**
 * Filer sintético con la forma del cable de la SEC.
 *
 * Ningún valor, fecha ni accession proviene de una descarga: el repositorio es
 * público y los extractos reales congelados son `F2-06`, con su propia revisión de
 * derechos. Lo que sí copia del cable real es la **forma** —columnas paralelas en
 * submissions, puntos agrupados por taxonomía, concepto y unidad en companyfacts—
 * y los casos que se observaron en él:
 *
 * - un balance de cierre reportado primero como comparativo en un 10-Q, repetido
 *   en el 10-K y re-expresado después por una 10-K/A;
 * - un ingreso trimestral, un acumulado de seis meses y uno anual;
 * - un importe por acción y acciones en circulación a la fecha de la carátula;
 * - un concepto que la selección no incluye;
 * - una presentación vieja que sólo aparece en el archivo histórico de
 *   submissions.
 */
import {
  identityGraphSchema,
  type IdentityGraph,
} from "@/modules/identity/domain/identity-graph";

export const FIXTURE_FILER_CIK = "0000000042";
export const FIXTURE_FILER_ENTITY_ID = "00000000-0000-4000-8000-00000000f001";

/** Constitución del universo sintético: el grafo no sabe nada antes de esto. */
export const FIXTURE_UNIVERSE_CONSTITUTED_AT = "2026-09-05T01:39:10.000Z";

/**
 * Grafo mínimo en el que el filer existe sólo desde la constitución del universo,
 * igual que el universo real frente a hechos de 2009.
 */
export function buildFixtureFilerGraph(): IdentityGraph {
  const provenance = {
    validFrom: FIXTURE_UNIVERSE_CONSTITUTED_AT,
    validTo: null,
    availableAt: FIXTURE_UNIVERSE_CONSTITUTED_AT,
    supersededAt: null,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    contentHash: "e".repeat(64),
    recordedAt: FIXTURE_UNIVERSE_CONSTITUTED_AT,
  };

  return identityGraphSchema.parse({
    legalEntities: [
      {
        ...provenance,
        legalEntityId: FIXTURE_FILER_ENTITY_ID,
        legalName: "Filer sintético",
        entityType: "operating_company",
        jurisdiction: null,
        status: "active",
      },
    ],
    securities: [],
    listings: [],
    listingSymbols: [],
    depositaryPrograms: [],
    depositaryRatios: [],
    identifierAssignments: [
      {
        ...provenance,
        sourceId: "sec-edgar",
        identifierAssignmentId: "00000000-0000-4000-8000-00000000f101",
        subjectType: "legal_entity",
        subjectId: FIXTURE_FILER_ENTITY_ID,
        identifierType: "cik",
        identifierValue: FIXTURE_FILER_CIK,
        normalizedValue: FIXTURE_FILER_CIK,
        scope: "sec:filer",
        issuingAuthority: "U.S. Securities and Exchange Commission",
        confidence: "authoritative",
      },
    ],
  });
}

export const FIXTURE_ACCESSIONS = {
  /** Sólo en el archivo histórico: 10-Q con el comparativo del cierre anterior. */
  q3Filing: "0000000042-09-000031",
  annual: "0000000042-10-000004",
  amendment: "0000000042-10-000012",
  q2Filing: "0000000042-10-000019",
} as const;

export const FIXTURE_ACCEPTED_AT = {
  q3Filing: "2009-11-03T21:15:11.000Z",
  annual: "2010-02-23T22:10:40.000Z",
  amendment: "2010-05-12T20:05:14.000Z",
  q2Filing: "2010-08-04T20:31:05.000Z",
} as const;

type WirePoint = Record<string, unknown>;

export type FixtureCompanyFactsOptions = {
  readonly cik?: number;
  /** Reemplaza el `val` crudo de un punto: `Concepto|índice` → texto JSON. */
  readonly rawValues?: Readonly<Record<string, string>>;
  /** Puntos adicionales por `unidad@Concepto` de `us-gaap`. */
  readonly extraPoints?: Readonly<Record<string, readonly WirePoint[]>>;
};

const A = FIXTURE_ACCESSIONS;

const ASSETS_POINTS: readonly WirePoint[] = [
  {
    end: "2008-12-31",
    val: "412000000",
    accn: A.q3Filing,
    fy: 2009,
    fp: "Q3",
    form: "10-Q",
    filed: "2009-11-03",
  },
  {
    end: "2008-12-31",
    val: "412000000",
    accn: A.annual,
    fy: 2009,
    fp: "FY",
    form: "10-K",
    filed: "2010-02-23",
  },
  {
    end: "2008-12-31",
    val: "396500000",
    accn: A.amendment,
    fy: 2009,
    fp: "FY",
    form: "10-K/A",
    filed: "2010-05-12",
    frame: "CY2008Q4I",
  },
];

const REVENUE_POINTS: readonly WirePoint[] = [
  {
    start: "2009-01-01",
    end: "2009-12-31",
    val: "180000000",
    accn: A.annual,
    fy: 2009,
    fp: "FY",
    form: "10-K",
    filed: "2010-02-23",
  },
  {
    start: "2010-04-01",
    end: "2010-06-30",
    val: "47500000",
    accn: A.q2Filing,
    fy: 2010,
    fp: "Q2",
    form: "10-Q",
    filed: "2010-08-04",
  },
  {
    start: "2010-01-01",
    end: "2010-06-30",
    val: "93000000",
    accn: A.q2Filing,
    fy: 2010,
    fp: "Q2",
    form: "10-Q",
    filed: "2010-08-04",
  },
];

const EPS_POINTS: readonly WirePoint[] = [
  {
    start: "2009-01-01",
    end: "2009-12-31",
    val: "1.37",
    accn: A.annual,
    fy: 2009,
    fp: "FY",
    form: "10-K",
    filed: "2010-02-23",
  },
];

const SHARES_POINTS: readonly WirePoint[] = [
  {
    end: "2010-02-15",
    val: "54000000",
    accn: A.annual,
    fy: 2009,
    fp: "FY",
    form: "10-K",
    filed: "2010-02-23",
  },
];

function renderPoints(
  concept: string,
  points: readonly WirePoint[],
  options: FixtureCompanyFactsOptions,
): string {
  return `[${points
    .map((wire, index) => {
      const { val, ...rest } = wire;
      const raw = options.rawValues?.[`${concept}|${index}`] ?? String(val);
      const body = JSON.stringify(rest).slice(1, -1);

      return `{${body}${body.length > 0 ? "," : ""}"val":${raw}}`;
    })
    .join(",")}]`;
}

/**
 * Texto JSON de companyfacts. Se arma como texto y no con `JSON.stringify` sobre
 * números para que un test pueda poner un valor que un `double` no representa.
 */
export function buildFixtureCompanyFactsText(
  options: FixtureCompanyFactsOptions = {},
): string {
  const usGaap: Record<string, Record<string, readonly WirePoint[]>> = {
    Assets: { USD: ASSETS_POINTS },
    Revenues: { USD: REVENUE_POINTS },
    EarningsPerShareDiluted: { "USD/shares": EPS_POINTS },
    // Fuera de la selección: se cuenta y no se publica.
    AccountsPayableCurrent: { USD: [ASSETS_POINTS[1]!] },
  };

  for (const [key, extra] of Object.entries(options.extraPoints ?? {})) {
    const [unit, concept] = key.split("@") as [string, string];
    usGaap[concept] = { ...(usGaap[concept] ?? {}), [unit]: extra };
  }

  const renderConcept = (
    concept: string,
    units: Record<string, readonly WirePoint[]>,
  ) =>
    `${JSON.stringify(concept)}:{"label":"sintético","description":"sintético","units":{${Object.entries(
      units,
    )
      .map(
        ([unit, points]) =>
          `${JSON.stringify(unit)}:${renderPoints(concept, points, options)}`,
      )
      .join(",")}}}`;

  return `{"cik":${options.cik ?? 42},"entityName":"Filer sintético","facts":{"dei":{${renderConcept(
    "EntityCommonStockSharesOutstanding",
    { shares: SHARES_POINTS },
  )}},"us-gaap":{${Object.entries(usGaap)
    .map(([concept, units]) => renderConcept(concept, units))
    .join(",")}}}}`;
}

export type FixtureFilingRow = {
  readonly accessionNumber: string;
  readonly filingDate: string;
  readonly reportDate: string;
  readonly acceptanceDateTime: string;
  readonly form: string;
};

function columns(rows: readonly FixtureFilingRow[]) {
  return {
    accessionNumber: rows.map((row) => row.accessionNumber),
    filingDate: rows.map((row) => row.filingDate),
    reportDate: rows.map((row) => row.reportDate),
    acceptanceDateTime: rows.map((row) => row.acceptanceDateTime),
    act: rows.map(() => "34"),
    form: rows.map((row) => row.form),
    size: rows.map(() => 1),
  };
}

export const FIXTURE_HISTORY_FILE = "CIK0000000042-submissions-001.json";

export const FIXTURE_RECENT_FILINGS: readonly FixtureFilingRow[] = [
  {
    accessionNumber: A.q2Filing,
    filingDate: "2010-08-04",
    reportDate: "2010-06-30",
    acceptanceDateTime: FIXTURE_ACCEPTED_AT.q2Filing,
    form: "10-Q",
  },
  {
    accessionNumber: A.amendment,
    filingDate: "2010-05-12",
    reportDate: "2009-12-31",
    acceptanceDateTime: FIXTURE_ACCEPTED_AT.amendment,
    form: "10-K/A",
  },
  {
    accessionNumber: A.annual,
    filingDate: "2010-02-23",
    reportDate: "2009-12-31",
    acceptanceDateTime: FIXTURE_ACCEPTED_AT.annual,
    form: "10-K",
  },
];

const HISTORY_FILINGS: readonly FixtureFilingRow[] = [
  {
    accessionNumber: A.q3Filing,
    filingDate: "2009-11-03",
    reportDate: "2009-09-30",
    acceptanceDateTime: FIXTURE_ACCEPTED_AT.q3Filing,
    form: "10-Q",
  },
];

export function buildFixtureSubmissions(
  overrides: {
    readonly recent?: readonly FixtureFilingRow[];
    readonly withHistory?: boolean;
  } = {},
): unknown {
  return {
    cik: FIXTURE_FILER_CIK,
    name: "Filer sintético",
    filings: {
      recent: columns(overrides.recent ?? FIXTURE_RECENT_FILINGS),
      files:
        overrides.withHistory === false
          ? []
          : [
              {
                name: FIXTURE_HISTORY_FILE,
                filingCount: HISTORY_FILINGS.length,
                filingFrom: "2009-01-02",
                filingTo: "2009-12-31",
              },
            ],
    },
  };
}

export function buildFixtureSubmissionsHistory(): unknown {
  return columns(HISTORY_FILINGS);
}
