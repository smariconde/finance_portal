import type {
  IndustryGold,
  MixGold,
} from "@/modules/ai-evals/domain/eval-cases";
import type {
  ExposureBasis,
  OperationsMixLine,
  OperationsMixOutput,
} from "@/modules/valuation/domain/operations-mix-task";

/**
 * La respuesta correcta de cada caso base (`F5-07`,
 * [ADR 0035](../../../../docs/architecture/adr/0035-ai-layer-evals.md),
 * decisión 3).
 *
 * La propuso el agente leyendo el extracto congelado —sembrada desde lo que la
 * policy aceptó en `F5-03` y `F5-05`, verificada columna por columna, y escrita a
 * mano para AAPL, CAT, DE y GOOGL, que ninguna corrida transcribió—. El owner
 * lo confirmó entero tal como está el 2026-10-19, con la «Europe» de Apple
 * leída como Europa —su definición no está en el extracto— y la comparación de
 * regiones estricta. Una entrada nueva vuelve a `pending_owner` hasta que la
 * confirme.
 *
 * El mix se escribe como una respuesta completa, con sus citas, para que la
 * misma policy que juzga al modelo juzgue al gold. Las citas son fragmentos del
 * extracto con los espacios colapsados, que es como la policy los compara.
 */
const reviewed = "owner_reviewed" as const;

const industry = (
  cik: string,
  industryKey: string,
  rationale: string,
): IndustryGold => ({ cik, industryKey, rationale, review: reviewed });

export const DECLARED_INDUSTRY_GOLD: readonly IndustryGold[] = Object.freeze([
  industry(
    "0000004977",
    "insurance-life",
    "Aflac vende seguros suplementarios de salud y de vida en Japón y Estados Unidos; Damodaran lo ubica en vida.",
  ),
  industry(
    "0000019617",
    "bank-money-center",
    "JPMorgan es un banco global con banca de inversión, el caso de money center.",
  ),
  industry(
    "0000036104",
    "banks-regional",
    "U.S. Bancorp es banca comercial y minorista doméstica, sin el negocio global de un money center.",
  ),
  industry(
    "0000070858",
    "bank-money-center",
    "Bank of America tiene banca global e inversión (Global Banking and Markets): money center.",
  ),
  industry(
    "0000726728",
    "retail-reits",
    "Realty Income alquila bajo net lease mayormente a inquilinos minoristas; el negocio de retail es la mayor parte de la renta.",
  ),
  industry(
    "0000815097",
    "recreation",
    "Carnival opera cruceros de turismo: Damodaran pone a las líneas de cruceros en recreación, no en transporte.",
  ),
  industry(
    "0000879169",
    "drugs-biotechnology",
    "Incyte descubre y vende medicamentos propios; el SIC de investigación no describe un servicio a terceros.",
  ),
  industry(
    "0001018724",
    "retail-general",
    "Amazon vende de todo en línea; AWS no supera a la venta minorista en ingresos.",
  ),
  industry(
    "0001045609",
    "r-e-i-t",
    "Prologis es un REIT logístico e industrial, no minorista.",
  ),
  industry(
    "0001053507",
    "r-e-i-t",
    "American Tower es un REIT de torres de comunicaciones, no minorista.",
  ),
  industry(
    "0001100682",
    "healthcare-support-services",
    "Charles River presta servicios de investigación preclínica y modelos de investigación a farmacéuticas: es un servicio, no un desarrollador de medicamentos.",
  ),
  industry(
    "0001108524",
    "software-system-and-application",
    "Salesforce vende software empresarial de aplicaciones como servicio.",
  ),
  industry(
    "0001326160",
    "utility-general",
    "Duke Energy es una utility regulada integrada de electricidad y gas.",
  ),
  industry(
    "0001513761",
    "recreation",
    "Norwegian opera cruceros de turismo, como Carnival.",
  ),
  industry(
    "0001652044",
    "software-internet",
    "Alphabet obtiene la mayor parte de sus ingresos de publicidad en sus servicios de internet (Search, YouTube).",
  ),
  industry(
    "0002115436",
    "oil-gas-integrated",
    "ExxonMobil es una petrolera integrada: upstream, refinación y química.",
  ),
]);

const line = (
  label: string,
  amount: string,
  quote: string,
  basis: ExposureBasis,
  exposureKeys: readonly string[],
  definitionQuote: string | null = null,
): OperationsMixLine => ({
  label,
  amount,
  quote,
  evidenceId: "E1",
  basis,
  exposureKeys: [...exposureKeys],
  definitionQuote,
});

const proposed = (
  unit: NonNullable<OperationsMixOutput["unit"]>,
  lines: readonly OperationsMixLine[],
  totalAmount: string,
  totalQuote: string,
): OperationsMixOutput => ({
  decision: "proposed",
  unit,
  lines: [...lines],
  totalAmount,
  totalQuote,
  totalEvidenceId: "E1",
  confidence: "high",
  rationale: "Owner-reviewed transcription of the fiscal year column.",
  abstainReason: null,
});

const mix = (
  cik: string,
  output: OperationsMixOutput,
  rationale: string,
): MixGold => ({ cik, output, rationale, review: reviewed });

const US = ["united-states"];
const EUROPE = ["western-europe", "eastern-europe"];
const ASIA_PACIFIC = ["asia", "australia-and-new-zealand"];
const AMERICAS = ["north-america", "central-and-south-america", "caribbean"];
const LATIN_AMERICA = ["central-and-south-america", "caribbean"];
const EMEA = ["western-europe", "eastern-europe", "middle-east", "africa"];

export const DECLARED_MIX_GOLD: readonly MixGold[] = Object.freeze([
  mix(
    "0000018230",
    proposed(
      "millions",
      [
        line(
          "North America",
          "$ 36,609",
          "Total Sales and Revenues $ 36,609 $ 6,988 $ 12,793 $ 11,199 $ 67,589",
          "name_match",
          ["north-america"],
        ),
        line(
          "Latin America",
          "$ 6,988",
          "Total Sales and Revenues $ 36,609 $ 6,988 $ 12,793 $ 11,199 $ 67,589",
          "name_match",
          LATIN_AMERICA,
        ),
        line(
          "EAME",
          "$ 12,793",
          "Total Sales and Revenues $ 36,609 $ 6,988 $ 12,793 $ 11,199 $ 67,589",
          "name_match",
          EMEA,
        ),
        line(
          "Asia/Pacific",
          "$ 11,199",
          "Total Sales and Revenues $ 36,609 $ 6,988 $ 12,793 $ 11,199 $ 67,589",
          "name_match",
          ASIA_PACIFIC,
        ),
      ],
      "$ 67,589",
      "Total Sales and Revenues $ 36,609 $ 6,988 $ 12,793 $ 11,199 $ 67,589",
    ),
    "La fila «Total Sales and Revenues» de 2025, con las eliminaciones corporativas ya repartidas por región; las filas de arriba son por segmento y no se suman aparte.",
  ),
  mix(
    "0000037996",
    proposed(
      "millions",
      [
        line(
          "United States",
          "$ 122,574",
          "United States $ 116,995 $ 42,235 $ 124,968 $ 45,392 $ 122,574 $ 44,994",
          "name_match",
          US,
        ),
        line(
          "Canada",
          "14,548",
          "Canada 13,391 6,147 13,412 6,548 14,548 8,567",
          "name_match",
          ["canada"],
        ),
        line(
          "United Kingdom",
          "12,298",
          "United Kingdom 8,968 1,868 9,936 2,174 12,298 2,260",
          "name_match",
          ["united-kingdom"],
        ),
        line(
          "Mexico",
          "2,463",
          "Mexico 2,774 5,222 2,634 4,352 2,463 3,515",
          "name_match",
          ["mexico"],
        ),
        line(
          "All Other",
          "35,384",
          "All Other 34,063 6,733 34,042 6,409 35,384 6,492",
          "rest_of_world",
          [],
        ),
      ],
      "$ 187,267",
      "Total Company $ 176,191 $ 62,205 $ 184,992 $ 64,875 $ 187,267 $ 65,828",
    ),
    "Ford intercala ingresos y activos de largo plazo por año desde 2023: los ingresos de 2025 son la quinta columna.",
  ),
  mix(
    "0000200406",
    proposed(
      "millions",
      [
        line(
          "United States",
          "$53,752",
          "United States $53,752 50,302 46,444 $89,392 70,670",
          "name_match",
          US,
        ),
        line(
          "Europe",
          "21,535",
          "Europe 21,535 20,212 20,410 27,987 27,267",
          "name_match",
          EUROPE,
        ),
        line(
          "Western Hemisphere excluding U.S.",
          "4,875",
          "Western Hemisphere excluding U.S. 4,875 4,714 4,549 2,204 1,728",
          "name_match",
          ["canada", "central-and-south-america", "caribbean"],
        ),
        line(
          "Asia-Pacific, Africa",
          "14,031",
          "Asia-Pacific, Africa 14,031 13,593 13,756 1,544 1,454",
          "name_match",
          ["asia", "australia-and-new-zealand", "africa"],
        ),
      ],
      "94,193",
      "Segments total 94,193 88,821 85,159",
    ),
    "Ventas a clientes de 2025, la primera de tres columnas de ventas; las dos últimas son activos de largo plazo.",
  ),
  mix(
    "0000315189",
    proposed(
      "millions",
      [
        line(
          "United States",
          "$ 23,974",
          "United States $ 7,753 $ 5,282 $ 6,489 $ 4,450 $ 23,974",
          "name_match",
          US,
        ),
        line(
          "Canada",
          "3,735",
          "Canada 1,735 496 743 761 3,735",
          "name_match",
          ["canada"],
        ),
        line(
          "Western Europe",
          "6,550",
          "Western Europe 2,070 2,340 1,955 185 6,550",
          "name_match",
          ["western-europe"],
        ),
        line(
          "Central Europe and CIS",
          "1,575",
          "Central Europe and CIS 832 359 373 11 1,575",
          "name_match",
          ["eastern-europe"],
        ),
        line(
          "Latin America",
          "5,607",
          "Latin America 4,021 453 936 197 5,607",
          "name_match",
          LATIN_AMERICA,
        ),
        line(
          "Asia, Africa, Oceania, and Middle East",
          "4,243",
          "Asia, Africa, Oceania, and Middle East 1,338 1,534 1,154 217 4,243",
          "name_match",
          ["asia", "africa", "australia-and-new-zealand", "middle-east"],
        ),
      ],
      "$ 45,684",
      "Total $ 17,749 $ 10,464 $ 11,650 $ 5,821 $ 45,684",
    ),
    "Mercados geográficos primarios de 2025: la columna Total, la quinta, después de los cuatro segmentos.",
  ),
  mix(
    "0000320193",
    proposed(
      "millions",
      [
        line(
          "Americas",
          "$ 178,353",
          "Americas $ 178,353 7 % $ 167,045",
          "name_match",
          AMERICAS,
        ),
        line(
          "Europe",
          "111,032",
          "Europe 111,032 10 % 101,328",
          "name_match",
          EUROPE,
        ),
        line(
          "Greater China",
          "64,377",
          "Greater China 64,377 (4) % 66,952",
          "name_match",
          ["china", "hong-kong", "taiwan"],
        ),
        line("Japan", "28,703", "Japan 28,703 15 % 25,052", "name_match", [
          "japan",
        ]),
        line(
          "Rest of Asia Pacific",
          "33,696",
          "Rest of Asia Pacific 33,696 10 % 30,658",
          "name_match",
          ASIA_PACIFIC,
        ),
      ],
      "$ 416,161",
      "Total net sales $ 416,161 6 % $ 391,035",
    ),
    "Ventas netas por segmento geográfico de 2025. Apple incluye India, Medio Oriente y África en «Europe», pero esa definición no está en el extracto: con la evidencia que recibe la tarea, «Europe» es Europa.",
  ),
  mix(
    "0000815097",
    proposed(
      "millions",
      [
        line(
          "United States",
          "$ 14,847",
          "United States $ 14,847 $ 14,061",
          "name_match",
          US,
        ),
        line("Germany", "3,348", "Germany 3,348 3,063", "name_match", [
          "germany",
        ]),
        line(
          "United Kingdom",
          "3,054",
          "United Kingdom 3,054 2,740",
          "name_match",
          ["united-kingdom"],
        ),
        line(
          "Other (a)",
          "5,374",
          "Other (a) 5,374 5,157",
          "rest_of_world",
          [],
        ),
      ],
      "$ 26,622",
      "Other (a) 5,374 5,157 4,406 $ 26,622 $ 25,021 $ 21,593",
    ),
    "Ingresos por país de 2025, la primera columna; el total no tiene etiqueta en la tabla.",
  ),
  mix(
    "0000831259",
    proposed(
      "millions",
      [
        line("U.S.", "$ 9,034", "U.S. $ 9,034 $ 7,806", "name_match", US),
        line("Switzerland", "5,334", "Switzerland 5,334 4,251", "name_match", [
          "switzerland",
        ]),
        line("Japan", "2,850", "Japan 2,850 5,930", "name_match", ["japan"]),
        line("Indonesia", "2,180", "Indonesia 2,180 1,108", "name_match", [
          "indonesia",
        ]),
        line("Singapore", "1,246", "Singapore 1,246 1,116", "name_match", [
          "singapore",
        ]),
        line(
          "United Kingdom",
          "1,136",
          "United Kingdom 1,136 115",
          "name_match",
          ["united-kingdom"],
        ),
        line("Spain", "723", "Spain 723 1,052", "name_match", ["spain"]),
        line("China", "636", "China 636 743", "name_match", ["china"]),
        line("Chile", "471", "Chile 471 451", "name_match", ["chile"]),
        line("Germany", "332", "Germany 332 500", "name_match", ["germany"]),
        line("France", "315", "France 315 306", "name_match", ["france"]),
        line("Egypt", "261", "Egypt 261 239", "name_match", ["egypt"]),
        line("South Korea", "193", "South Korea 193 203", "name_match", [
          "korea",
        ]),
        line("India", "163", "India 163 273", "name_match", ["india"]),
        line("Philippines", "3", "Philippines 3 283", "name_match", [
          "philippines",
        ]),
        line("Other", "1,038", "Other 1,038 1,079", "rest_of_world", []),
      ],
      "$ 25,915",
      "Total $ 25,915 $ 25,455",
    ),
    "Ingresos por país del cliente de 2025, la primera columna.",
  ),
  mix(
    "0000879169",
    proposed(
      "thousands",
      [
        line(
          "United States",
          "$ 4,799,941",
          "United States $ 4,799,941 $ 3,974,567",
          "name_match",
          US,
        ),
        line(
          "Europe",
          "323,734",
          "Europe 323,734 260,437",
          "name_match",
          EUROPE,
        ),
        line(
          "Other countries",
          "17,567",
          "Other countries 17,567 6,213",
          "rest_of_world",
          [],
        ),
      ],
      "$ 5,141,242",
      "Total revenues $ 5,141,242 $ 4,241,217",
    ),
    "Ingresos por geografía de 2025, la primera columna.",
  ),
  mix(
    "0001018724",
    proposed(
      "millions",
      [
        line(
          "United States",
          "$ 489,657",
          "United States $ 395,637 $ 438,015 $ 489,657",
          "name_match",
          US,
        ),
        line(
          "Germany",
          "45,900",
          "Germany 37,588 40,856 45,900",
          "name_match",
          ["germany"],
        ),
        line(
          "United Kingdom",
          "43,212",
          "United Kingdom 33,591 37,855 43,212",
          "name_match",
          ["united-kingdom"],
        ),
        line("Japan", "30,688", "Japan 26,002 27,401 30,688", "name_match", [
          "japan",
        ]),
        line(
          "Rest of world",
          "107,467",
          "Rest of world 81,967 93,832 107,467",
          "rest_of_world",
          [],
        ),
      ],
      "$ 716,924",
      "Consolidated $ 574,785 $ 637,959 $ 716,924",
    ),
    "Ventas netas por país de 2025: Amazon ordena las columnas de 2023 a 2025, así que es la tercera.",
  ),
  mix(
    "0001045810",
    proposed(
      "millions",
      [
        line(
          "United States",
          "$ 149,617",
          "United States $ 149,617 $ 77,482",
          "name_match",
          US,
        ),
        line("Taiwan", "42,345", "Taiwan (2) 42,345 23,600", "name_match", [
          "taiwan",
        ]),
        line(
          "China (including Hong Kong)",
          "19,677",
          "China (including Hong Kong) 19,677 25,048",
          "filing_definition",
          ["china", "hong-kong"],
          "China (including Hong Kong)",
        ),
        line("Other", "4,299", "Other 4,299 4,367", "rest_of_world", []),
      ],
      "$ 215,938",
      "Total revenue $ 215,938 $ 130,497",
    ),
    "Ingresos por ubicación del cliente del ejercicio 2026 de NVIDIA, la primera columna; la etiqueta de China dice qué incluye.",
  ),
  mix(
    "0001100682",
    proposed(
      "thousands",
      [
        line(
          "U.S.",
          "$ 2,141,773",
          "Fiscal Year 2025 $ 2,141,773 $ 1,102,696 $ 501,025 $ 205,023 $ 64,865 $ 4,015,382",
          "name_match",
          US,
        ),
        line(
          "Europe",
          "$ 1,102,696",
          "Fiscal Year 2025 $ 2,141,773 $ 1,102,696 $ 501,025 $ 205,023 $ 64,865 $ 4,015,382",
          "name_match",
          EUROPE,
        ),
        line(
          "Canada",
          "$ 501,025",
          "Fiscal Year 2025 $ 2,141,773 $ 1,102,696 $ 501,025 $ 205,023 $ 64,865 $ 4,015,382",
          "name_match",
          ["canada"],
        ),
        line(
          "Asia Pacific",
          "$ 205,023",
          "Fiscal Year 2025 $ 2,141,773 $ 1,102,696 $ 501,025 $ 205,023 $ 64,865 $ 4,015,382",
          "name_match",
          ASIA_PACIFIC,
        ),
        line(
          "Other (1)",
          "$ 64,865",
          "Fiscal Year 2025 $ 2,141,773 $ 1,102,696 $ 501,025 $ 205,023 $ 64,865 $ 4,015,382",
          "filing_definition",
          ["brazil", "israel", "mauritius"],
          "The Other category represents operations located in Brazil, Israel, and Mauritius.",
        ),
      ],
      "$ 4,015,382",
      "Fiscal Year 2025 $ 2,141,773 $ 1,102,696 $ 501,025 $ 205,023 $ 64,865 $ 4,015,382",
    ),
    "La tabla de Charles River va en filas por año y columnas por región: la fila del ejercicio 2025, con «Other» definido por la nota (1).",
  ),
  mix(
    "0001108524",
    proposed(
      "millions",
      [
        line(
          "Americas",
          "$ 27,193",
          "Americas $ 27,193 65 %",
          "name_match",
          AMERICAS,
        ),
        line("Europe", "10,017", "Europe 10,017 25", "name_match", EUROPE),
        line(
          "Asia Pacific",
          "4,315",
          "Asia Pacific 4,315 10",
          "name_match",
          ASIA_PACIFIC,
        ),
      ],
      "$ 41,525",
      "Total $ 41,525 100 %",
    ),
    "Ingresos por región del ejercicio 2026 de Salesforce, la primera columna.",
  ),
  mix(
    "0001164727",
    proposed(
      "millions",
      [
        line(
          "United Kingdom",
          "$ 13,068",
          "United Kingdom (1) $ 13,068 $ 10,966",
          "name_match",
          ["united-kingdom"],
        ),
        line("South Korea", "3,196", "South Korea 3,196 1,956", "name_match", [
          "korea",
        ]),
        line("Japan", "2,002", "Japan 2,002 1,920", "name_match", ["japan"]),
        line("China", "1,411", "China 1,411 318", "name_match", ["china"]),
        line("Australia", "803", "Australia 803 409", "name_match", [
          "australia",
        ]),
        line("Mexico", "639", "Mexico 639 600", "name_match", ["mexico"]),
        line("Switzerland", "89", "Switzerland 89 638", "name_match", [
          "switzerland",
        ]),
        line("Philippines", "82", "Philippines 82 709", "name_match", [
          "philippines",
        ]),
        line("United States", "—", "United States — 2 48", "name_match", US),
        line("Other", "1,379", "Other 1,379 1,164", "rest_of_world", []),
      ],
      "$ 22,669",
      "Other 1,379 1,164 871 $ 22,669",
    ),
    "Ingresos por ubicación del cliente de 2025: Newmont vende el oro donde se refina, por eso el Reino Unido. Estados Unidos imprime una raya, que es cero.",
  ),
  mix(
    "0001513761",
    proposed(
      "thousands",
      [
        line(
          "North America",
          "$ 5,649,039",
          "North America $ 5,649,039",
          "filing_definition",
          ["united-states", "caribbean", "canada", "mexico"],
          "North America includes the U.S., the Caribbean, Canada and Mexico.",
        ),
        line(
          "Europe",
          "2,898,886",
          "Europe 2,898,886 3,035,406",
          "filing_definition",
          EUROPE,
          "Europe includes the Baltic region, Canary Islands and Mediterranean.",
        ),
        line(
          "Asia-Pacific",
          "996,748",
          "Asia-Pacific 996,748 779,484",
          "filing_definition",
          ASIA_PACIFIC,
          "Asia-Pacific includes Australia, New Zealand and Asia.",
        ),
        line("Other", "282,919", "Other 282,919 346,085", "rest_of_world", []),
      ],
      "$ 9,827,592",
      "Total revenue $ 9,827,592 $ 9,479,651",
    ),
    "Ingresos por destino de los cruceros de 2025, con cada región definida por el filing.",
  ),
  mix(
    "0001652044",
    proposed(
      "millions",
      [
        line(
          "United States",
          "$ 194,229",
          "United States $ 146,286 47 % $ 170,447 49 % $ 194,229 48 %",
          "name_match",
          US,
        ),
        line(
          "EMEA(1)",
          "117,152",
          "EMEA(1) 91,038 30 102,127 29 117,152 29",
          "name_match",
          EMEA,
        ),
        line(
          "APAC(1)",
          "67,680",
          "APAC(1) 51,514 17 56,815 16 67,680 17",
          "name_match",
          ASIA_PACIFIC,
        ),
        line(
          "Other Americas(1)",
          "23,902",
          "Other Americas(1) 18,320 6 20,418 6 23,902 6",
          "filing_definition",
          ["canada", "central-and-south-america", "caribbean"],
          'Canada and Latin America ("Other Americas")',
        ),
        line(
          "Hedging gains (losses)",
          "(127)",
          "Hedging gains (losses) 236 0 211 0 (127) 0",
          "unallocated",
          [],
        ),
      ],
      "$ 402,836",
      "Total revenues $ 307,394 100 % $ 350,018 100 % $ 402,836 100 %",
    ),
    "Ingresos por dirección del cliente de 2025, la tercera columna; la cobertura es una partida de conciliación y «Other Americas» lo define la nota (1).",
  ),
  mix(
    "0001682852",
    proposed(
      "millions",
      [
        line(
          "United States",
          "$ 1,199",
          "United States $ 1,199 $ 1,785",
          "name_match",
          US,
        ),
        line("Europe", "53", "Europe 53 598", "name_match", EUROPE),
        line(
          "Rest of world",
          "692",
          "Rest of world 692 853",
          "rest_of_world",
          [],
        ),
      ],
      "$ 1,944",
      "Total $ 1,944 $ 3,236",
    ),
    "Ingresos por geografía de 2025, la primera columna.",
  ),
  mix(
    "0002115436",
    proposed(
      "millions",
      [
        line(
          "United States",
          "137,639",
          "United States 137,639 138,657 127,374",
          "name_match",
          US,
        ),
        line(
          "Non-U.S.",
          "186,266",
          "Non-U.S. 186,266 200,590 207,323",
          "rest_of_world",
          [],
        ),
      ],
      "323,905",
      "Non-U.S. 186,266 200,590 207,323 Total 323,905",
    ),
    "Ventas por geografía de 2025: Estados Unidos y el resto. Canadá aparece aparte como fuente significativa, pero ya está dentro de «Non-U.S.»: separarla contaría dos veces.",
  ),
]);
