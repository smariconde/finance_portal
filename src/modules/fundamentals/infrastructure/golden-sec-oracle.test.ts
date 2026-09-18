import { describe, expect, it } from "vitest";

import {
  parseSecCompanyFacts,
  type SecReportedFact,
} from "../domain/parse-sec-company-facts";
import { parseSecSubmissions } from "../domain/parse-sec-submissions";
import {
  isSelectedSecConcept,
  isSplitEvidenceConcept,
} from "../domain/sec-concept-selection";
import { applySecHistoryWindow } from "../domain/sec-history-window";

import {
  findGoldenCorpusEntry,
  loadGoldenCorpusManifest,
  readGoldenCorpusText,
} from "./golden-sec-corpus";

/**
 * El cable real de la SEC como oráculo de regresión.
 *
 * Vive al lado del corpus y no al lado de un parser porque lo que prueba no es
 * una función: es el **par** parser–cable. El filer sintético
 * (`fixture-sec-filer.ts`) sigue probando que cada parser hace lo que creemos,
 * con los casos que el cable real no ofrece —parser roto, fuente caída, lote
 * vacío—. Acá se prueba lo otro: que el cable sea como creemos, y que lo que sale
 * de él sea lo que dice el filing.
 *
 * Los números de este archivo están **commiteados a propósito**. Cuando uno se
 * mueve, la pregunta no es «arreglar el test»: es qué cambió, si el parser o la
 * SEC, y por qué. Actualizar el corpus es `pnpm fixtures:capture --apply` y un
 * diff revisable; nada acá resuelve «lo último» en runtime ni abre un socket.
 */
const manifest = loadGoldenCorpusManifest();

function companyFacts(cik: string): readonly SecReportedFact[] {
  const result = parseSecCompanyFacts(
    readGoldenCorpusText(
      findGoldenCorpusEntry(manifest, cik, "sec.companyfacts"),
    ),
    isSelectedSecConcept,
  );

  if (!result.ok) {
    throw new Error(`companyfacts de ${cik}: ${result.code}`);
  }

  return result.facts;
}

/**
 * Lo que cada extracto congelado produce hoy. Los seis son arquetipos distintos:
 * tech con split reciente, tech con split de 2022, energía, utility regulada, y
 * el sucesor de reporte de ExxonMobil, que todavía no publicó un cierre anual.
 */
const EXPECTED = [
  {
    cik: "0000320193",
    name: "Apple",
    counts: {
      concepts: 50,
      selectedConcepts: 44,
      points: 3380,
      selectedPoints: 2999,
    },
    window: { kept: 2238, outside: 761, anchorBasis: "annual_report" },
  },
  {
    cik: "0001045810",
    name: "NVIDIA",
    counts: {
      concepts: 58,
      selectedConcepts: 48,
      points: 3403,
      selectedPoints: 3079,
    },
    window: { kept: 2205, outside: 874, anchorBasis: "annual_report" },
  },
  {
    cik: "0001652044",
    name: "Alphabet",
    counts: {
      concepts: 51,
      selectedConcepts: 42,
      points: 2895,
      selectedPoints: 2508,
    },
    window: { kept: 1836, outside: 672, anchorBasis: "annual_report" },
  },
  {
    cik: "0001326160",
    name: "Duke Energy",
    counts: {
      concepts: 45,
      selectedConcepts: 39,
      points: 2652,
      selectedPoints: 2421,
    },
    window: { kept: 1732, outside: 689, anchorBasis: "annual_report" },
  },
  {
    cik: "0000034088",
    name: "ExxonMobil, CIK anterior",
    counts: {
      concepts: 42,
      selectedConcepts: 37,
      points: 2802,
      selectedPoints: 2512,
    },
    window: { kept: 1717, outside: 795, anchorBasis: "annual_report" },
  },
  {
    cik: "0002115436",
    name: "ExxonMobil, CIK sucesor",
    counts: {
      concepts: 31,
      selectedConcepts: 28,
      points: 98,
      selectedPoints: 89,
    },
    // Todavía no presentó un 10-K propio: el ancla cae en su último período.
    window: { kept: 89, outside: 0, anchorBasis: "latest_period" },
  },
] as const;

describe("companyfacts real", () => {
  it.each(EXPECTED.map((filer) => [filer.name, filer] as const))(
    "%s se parsea sin una sola fila rechazada",
    (_name, filer) => {
      const result = parseSecCompanyFacts(
        readGoldenCorpusText(
          findGoldenCorpusEntry(manifest, filer.cik, "sec.companyfacts"),
        ),
        isSelectedSecConcept,
      );

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      // Una fila rechazada contra el cable real es una de dos cosas: la SEC
      // publicó algo que no entendemos, o el parser dejó de entender algo que ya
      // publicaba. Las dos merecen mirarse; ninguna es ruido.
      expect(result.rejections).toStrictEqual([]);
      expect(result.cik).toBe(filer.cik);
      expect(result.counts).toStrictEqual(filer.counts);
    },
  );

  it("da el ingreso de Apple que está en el 10-K, y no otro", () => {
    // Reconciliación contra el filing: los US$ 391.035 millones del ejercicio
    // cerrado el 2024-09-28 son los del 10-K de Apple, y el importe llega exacto
    // desde el texto fuente y no por un `double`.
    const annualRevenue = companyFacts("0000320193").filter(
      (fact) =>
        fact.concept ===
          "RevenueFromContractWithCustomerExcludingAssessedTax" &&
        fact.start === "2023-10-01" &&
        fact.end === "2024-09-28",
    );

    expect(annualRevenue.map((fact) => fact.value)).toStrictEqual([
      "391035000000",
      "391035000000",
    ]);
    expect(annualRevenue.map((fact) => fact.accessionNumber)).toStrictEqual([
      "0000320193-24-000123",
      "0000320193-25-000079",
    ]);
  });

  it("conserva el mismo ejercicio repetido por tres 10-K sin colapsarlo", () => {
    // El ejercicio 2019 vuelve a aparecer como comparativo en los 10-K de 2020 y
    // 2021 con el mismo valor. Tres vintages del mismo período es lo que la
    // consulta `as_known` necesita para no adelantar una enmienda.
    const fiscal2019 = companyFacts("0000320193").filter(
      (fact) =>
        fact.concept ===
          "RevenueFromContractWithCustomerExcludingAssessedTax" &&
        fact.start === "2018-09-30" &&
        fact.end === "2019-09-28",
    );

    expect(fiscal2019).toHaveLength(3);
    expect(new Set(fiscal2019.map((fact) => fact.value))).toStrictEqual(
      new Set(["260174000000"]),
    );
    expect(fiscal2019.map((fact) => fact.accessionNumber)).toStrictEqual([
      "0000320193-19-000119",
      "0000320193-20-000096",
      "0000320193-21-000105",
    ]);
  });

  it("guarda el EPS de NVIDIA antes y después del split, sin pisar el original", () => {
    // El 10:1 de junio de 2024 re-expresó el ejercicio cerrado el 2024-01-28: el
    // 10-K de ese año lo publicó en 12,05 y el siguiente lo repitió en 1,21. Los
    // dos quedan, cada uno con su presentación, que es de lo que depende
    // `latest_adjusted` (ADR 0012).
    const annualEps = companyFacts("0001045810").filter(
      (fact) =>
        fact.concept === "EarningsPerShareBasic" &&
        fact.start === "2023-01-30" &&
        fact.end === "2024-01-28",
    );

    expect(
      annualEps.map((fact) => [fact.accessionNumber, fact.value, fact.unit]),
    ).toStrictEqual([
      ["0001045810-24-000029", "12.05", "USD/shares"],
      ["0001045810-25-000023", "1.21", "USD/shares"],
      ["0001045810-26-000021", "1.21", "USD/shares"],
    ]);
  });

  it("trae un segundo split con otra razón, para que la regla no se ate a una", () => {
    // Alphabet, 20:1 en julio de 2022: el ejercicio 2021 pasó de 113,88 a 5,69.
    // Tener dos razones distintas en el corpus es lo que impide que una regla
    // acertada por casualidad con el 10:1 de NVIDIA pase inadvertida.
    const annualEps = companyFacts("0001652044").filter(
      (fact) =>
        fact.concept === "EarningsPerShareBasic" &&
        fact.start === "2021-01-01" &&
        fact.end === "2021-12-31",
    );

    expect(
      annualEps.map((fact) => [fact.accessionNumber, fact.value]),
    ).toStrictEqual([
      ["0001652044-22-000019", "113.88"],
      ["0001652044-23-000016", "5.69"],
      ["0001652044-24-000022", "5.69"],
    ]);
  });

  it.each(EXPECTED.map((filer) => [filer.name, filer] as const))(
    "la ventana de cinco ejercicios corta historia real de %s",
    (_name, filer) => {
      const selection = applySecHistoryWindow(
        companyFacts(filer.cik),
        isSplitEvidenceConcept,
      );

      // El corpus se congela con ocho ejercicios justamente para que acá sobre
      // algo: si el reductor usara la ventana, este número sería siempre 0 y el
      // test no mediría nada.
      expect(selection.counts.kept).toBe(filer.window.kept);
      expect(selection.counts.outside).toBe(filer.window.outside);
      expect(selection.window?.anchorBasis).toBe(filer.window.anchorBasis);
    },
  );
});

describe("submissions real", () => {
  function submissions(cik: string) {
    const result = parseSecSubmissions(
      JSON.parse(
        readGoldenCorpusText(
          findGoldenCorpusEntry(manifest, cik, "sec.submissions"),
        ),
      ),
    );

    if (!result.ok) {
      throw new Error(`submissions de ${cik}: ${result.code}`);
    }

    return result;
  }

  it("mantiene cada presentación con sus propias fechas después de congelar", () => {
    // Las columnas de `filings.recent` son paralelas: recortar el extracto es
    // elegir índices, y un desalineo pondría cada accession con la fecha de la
    // siguiente. Los 10-K de Apple son la prueba, porque sus fechas son
    // verificables contra EDGAR una por una.
    const tenK = submissions("0000320193").filings.filter(
      (filing) => filing.form === "10-K",
    );

    expect(
      tenK
        .slice(0, 3)
        .map((filing) => [
          filing.accessionNumber,
          filing.filingDate,
          filing.reportDate,
        ]),
    ).toStrictEqual([
      ["0000320193-25-000079", "2025-10-31", "2025-09-27"],
      ["0000320193-24-000123", "2024-11-01", "2024-09-28"],
      ["0000320193-23-000106", "2023-11-03", "2023-09-30"],
    ]);
  });

  it("trae los dos casos en que la aceptación y la fecha de presentación no coinciden", () => {
    // Es la distinción que sostiene `available_at` (ADR 0010). El 10-K de 2023 se
    // aceptó a las 18:08 ET, después del corte de las 17:30, así que EDGAR le puso
    // la fecha del día siguiente: quien use `filingDate` como disponibilidad
    // atrasa el hecho un día. El de 2024 entró un minuto después de que EDGAR
    // abre, a las 06:01 ET, y ahí sí coinciden.
    const byAccession = new Map(
      submissions("0000320193").filings.map((filing) => [
        filing.accessionNumber,
        filing,
      ]),
    );

    const late = byAccession.get("0000320193-23-000106");
    const early = byAccession.get("0000320193-24-000123");

    expect(late?.acceptedAt).toBe("2023-11-02T22:08:27.000Z");
    expect(late?.filingDate).toBe("2023-11-03");
    expect(early?.acceptedAt).toBe("2024-11-01T10:01:36.000Z");
    expect(early?.filingDate).toBe("2024-11-01");
  });

  it("conserva el índice de archivos históricos que decidiría qué más pedir", () => {
    const history = submissions("0000320193").historyFiles;

    expect(history).toStrictEqual([
      {
        name: "CIK0000320193-submissions-001.json",
        filingFrom: "1994-01-26",
        filingTo: "2015-07-22",
      },
    ]);
  });

  it.each(EXPECTED.map((filer) => [filer.name, filer.cik] as const))(
    "%s no deja ninguna presentación sin entender",
    (_name, cik) => {
      const result = submissions(cik);

      expect(result.rejections).toStrictEqual([]);
      expect(result.cik).toBe(cik);
      expect(result.filings.length).toBeGreaterThan(0);
    },
  );
});
