/**
 * Los casos de los evals de la capa IA (`F5-07`,
 * [ADR 0035](../../../../docs/architecture/adr/0035-ai-layer-evals.md),
 * decisiones 2 y 4), **declarados**: el corpus es un extracto elegido, no lo que
 * pasó por una corrida del modo personal.
 *
 * Son las empresas que midieron las dos tareas —las 16 ambiguas de `F5-03` y las
 * 17 no financieras con tabla geográfica de `F5-05`—, cada una con el 10-K que
 * leyó su corrida. Lo que la entrada de una tarea necesita además de la
 * evidencia sale de la SEC y viaja acá: el nombre como lo registra el grafo, el
 * SIC con su descripción y los ingresos del ejercicio de `companyfacts`.
 */
export type DeclaredEvalDocument = {
  readonly cik: string;
  readonly ticker: string;
  readonly companyName: string;
  readonly accessionNumber: string;
  readonly documentUrl: string;
};

export type DeclaredIndustryEvalBase = {
  readonly cik: string;
  readonly sic: { readonly code: string; readonly description: string };
};

export type DeclaredMixEvalBase = {
  readonly cik: string;
  /** Ingresos del ejercicio del 10-K, en USD, de `companyfacts`. */
  readonly expectedRevenue: string;
  readonly fiscalYearEnd: string;
};

const archive = (cik: string, accession: string, document: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/gu, "")}/${document}`;

const doc = (
  ticker: string,
  cik: string,
  companyName: string,
  accessionNumber: string,
  document: string,
  /** El CIK bajo el que el archivo guarda el documento, si es otro. */
  archiveCik: string = cik,
): DeclaredEvalDocument => ({
  cik,
  ticker,
  companyName,
  accessionNumber,
  documentUrl: archive(archiveCik, accessionNumber, document),
});

export const DECLARED_EVAL_DOCUMENTS: readonly DeclaredEvalDocument[] =
  Object.freeze([
    doc(
      "AFL",
      "0000004977",
      "AFLAC INC",
      "0001628280-26-011402",
      "afl-20251231.htm",
    ),
    doc(
      "CAT",
      "0000018230",
      "CATERPILLAR INC",
      "0000018230-26-000008",
      "cat-20251231.htm",
    ),
    doc(
      "JPM",
      "0000019617",
      "JPMORGAN CHASE & CO",
      "0001628280-26-008131",
      "jpm-20251231.htm",
    ),
    doc(
      "USB",
      "0000036104",
      "US BANCORP \\DE\\",
      "0000036104-26-000011",
      "usb-20251231.htm",
    ),
    doc(
      "F",
      "0000037996",
      "FORD MOTOR CO",
      "0000037996-26-000015",
      "f-20251231.htm",
    ),
    doc(
      "BAC",
      "0000070858",
      "BANK OF AMERICA CORP /DE/",
      "0000070858-26-000157",
      "bac-20251231.htm",
    ),
    doc(
      "JNJ",
      "0000200406",
      "JOHNSON & JOHNSON",
      "0000200406-26-000016",
      "jnj-20251228.htm",
    ),
    doc(
      "DE",
      "0000315189",
      "DEERE & CO",
      "0001104659-25-122321",
      "de-20251102x10k.htm",
    ),
    doc(
      "AAPL",
      "0000320193",
      "Apple Inc.",
      "0000320193-25-000079",
      "aapl-20250927.htm",
    ),
    doc(
      "O",
      "0000726728",
      "REALTY INCOME CORP",
      "0000726728-26-000011",
      "o-20251231.htm",
    ),
    doc(
      "CCL",
      "0000815097",
      "Carnival Corp Ltd.",
      "0000815097-26-000007",
      "ccl-20251130.htm",
    ),
    doc(
      "FCX",
      "0000831259",
      "FREEPORT-MCMORAN INC",
      "0000831259-26-000012",
      "fcx-20251231.htm",
    ),
    doc(
      "INCY",
      "0000879169",
      "INCYTE CORP",
      "0000879169-26-000010",
      "incy-20251231.htm",
    ),
    doc(
      "AMZN",
      "0001018724",
      "AMAZON COM INC",
      "0001018724-26-000004",
      "amzn-20251231.htm",
    ),
    doc(
      "PLD",
      "0001045609",
      "Prologis, Inc.",
      "0001193125-26-051453",
      "pld-20251231.htm",
    ),
    doc(
      "NVDA",
      "0001045810",
      "NVIDIA CORP",
      "0001045810-26-000021",
      "nvda-20260125.htm",
    ),
    doc(
      "AMT",
      "0001053507",
      "AMERICAN TOWER CORP /MA/",
      "0001053507-26-000035",
      "amt-20251231.htm",
    ),
    doc(
      "CRL",
      "0001100682",
      "CHARLES RIVER LABORATORIES INTERNATIONAL, INC.",
      "0001100682-26-000022",
      "crl-20251227.htm",
    ),
    doc(
      "CRM",
      "0001108524",
      "Salesforce, Inc.",
      "0001108524-26-000060",
      "crm-20260131.htm",
    ),
    doc(
      "NEM",
      "0001164727",
      "NEWMONT Corp /DE/",
      "0001164727-26-000010",
      "nem-20251231.htm",
    ),
    doc(
      "DUK",
      "0001326160",
      "Duke Energy CORP",
      "0001326160-26-000014",
      "duk-20251231.htm",
    ),
    doc(
      "NCLH",
      "0001513761",
      "Norwegian Cruise Line Holdings Ltd.",
      "0001104659-26-022067",
      "nclh-20251231x10k.htm",
    ),
    doc(
      "GOOGL",
      "0001652044",
      "Alphabet Inc.",
      "0001652044-26-000018",
      "goog-20251231.htm",
    ),
    doc(
      "MRNA",
      "0001682852",
      "Moderna, Inc.",
      "0001682852-26-000033",
      "mrna-20251231.htm",
    ),
    // El 10-K de ExxonMobil lo presentó su antecesor declarado, y el archivo lo
    // guarda bajo el CIK de aquél.
    doc(
      "XOM",
      "0002115436",
      "ExxonMobil Holdings Corp",
      "0000034088-26-000045",
      "xom-20251231.htm",
      "0000034088",
    ),
  ]);

const sic = (code: string, description: string) => ({ code, description });

export const DECLARED_INDUSTRY_EVAL_BASES: readonly DeclaredIndustryEvalBase[] =
  Object.freeze([
    { cik: "0000004977", sic: sic("6321", "Accident & Health Insurance") },
    { cik: "0000019617", sic: sic("6021", "National Commercial Banks") },
    { cik: "0000036104", sic: sic("6021", "National Commercial Banks") },
    { cik: "0000070858", sic: sic("6021", "National Commercial Banks") },
    { cik: "0000726728", sic: sic("6798", "Real Estate Investment Trusts") },
    { cik: "0000815097", sic: sic("4400", "Water Transportation") },
    {
      cik: "0000879169",
      sic: sic("8731", "Services-Commercial Physical & Biological Research"),
    },
    {
      cik: "0001018724",
      sic: sic("5961", "Retail-Catalog & Mail-Order Houses"),
    },
    { cik: "0001045609", sic: sic("6798", "Real Estate Investment Trusts") },
    { cik: "0001053507", sic: sic("6798", "Real Estate Investment Trusts") },
    {
      cik: "0001100682",
      sic: sic("8731", "Services-Commercial Physical & Biological Research"),
    },
    { cik: "0001108524", sic: sic("7372", "Services-Prepackaged Software") },
    {
      cik: "0001326160",
      sic: sic("4931", "Electric & Other Services Combined"),
    },
    { cik: "0001513761", sic: sic("4400", "Water Transportation") },
    {
      cik: "0001652044",
      sic: sic("7370", "Services-Computer Programming, Data Processing, Etc."),
    },
    { cik: "0002115436", sic: sic("2911", "Petroleum Refining") },
  ]);

const mix = (
  cik: string,
  expectedRevenue: string,
  fiscalYearEnd: string,
): DeclaredMixEvalBase => ({ cik, expectedRevenue, fiscalYearEnd });

export const DECLARED_MIX_EVAL_BASES: readonly DeclaredMixEvalBase[] =
  Object.freeze([
    mix("0000018230", "67589000000", "2025-12-31"),
    mix("0000037996", "187267000000", "2025-12-31"),
    mix("0000200406", "94193000000", "2025-12-28"),
    mix("0000315189", "45684000000", "2025-11-02"),
    mix("0000320193", "416161000000", "2025-09-27"),
    mix("0000815097", "26622000000", "2025-11-30"),
    mix("0000831259", "25915000000", "2025-12-31"),
    mix("0000879169", "5141242000", "2025-12-31"),
    mix("0001018724", "716924000000", "2025-12-31"),
    mix("0001045810", "215938000000", "2026-01-25"),
    mix("0001100682", "4015382000", "2025-12-27"),
    mix("0001108524", "41525000000", "2026-01-31"),
    mix("0001164727", "22669000000", "2025-12-31"),
    mix("0001513761", "9827592000", "2025-12-31"),
    mix("0001652044", "402836000000", "2025-12-31"),
    mix("0001682852", "1944000000", "2025-12-31"),
    mix("0002115436", "332238000000", "2025-12-31"),
  ]);

/**
 * A qué empresas se aplica cada inyección y cada abstención: tres por tarea,
 * elegidas por diversidad de candidatas y de tamaño de tabla. La línea
 * inventada de `fake_line` pesa más del 0,5 % del total de las tres, así que la
 * suma la delata.
 */
export const DECLARED_EVAL_TARGETS = Object.freeze({
  industryInjections: ["0001018724", "0001652044", "0000019617"],
  industryAbstentions: ["0001108524", "0001100682", "0000726728"],
  mixInjections: ["0001018724", "0001045810", "0000200406"],
  mixAbstentions: ["0001108524", "0002115436", "0000879169"],
});
