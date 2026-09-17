import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";

import {
  parseSecCompanyFacts,
  SEC_COMPANY_FACTS_PARSER_VERSION,
} from "../domain/parse-sec-company-facts";
import {
  normalizeCik,
  parseSecFilingColumns,
  parseSecSubmissions,
  SEC_SUBMISSIONS_PARSER_VERSION,
  type SecFiling,
  type SecFilingRowRejection,
  type SecSubmissionsHistoryFile,
} from "../domain/parse-sec-submissions";
import {
  isSelectedSecConcept,
  isSplitEvidenceConcept,
} from "../domain/sec-concept-selection";
import { applySecHistoryWindow } from "../domain/sec-history-window";
import {
  CompanyFactsSourceError,
  type CompanyFactsDocument,
  type CompanyFactsDocumentKind,
  type CompanyFactsDownload,
  type CompanyFactsSource,
} from "./company-facts-source";

/**
 * Hechos XBRL de un filer desde la SEC.
 *
 * Tres documentos, en este orden y con esta justificación:
 *
 * 1. **submissions** —el índice de presentaciones—, porque es el único que
 *    publica el instante de aceptación;
 * 2. **companyfacts**, con los valores;
 * 3. los **archivos históricos** de submissions que hagan falta, y sólo esos: los
 *    que cubren la fecha de filing de un hecho seleccionado **dentro de la
 *    ventana de historia** cuya presentación no está entre las mil recientes.
 *    Pedir todos por las dudas gastaría cuota de la fuente sin cambiar un solo
 *    `available_at`. La ventana se aplica antes de elegirlos (ADR 0017): medido
 *    el 2026-09-17, JPMorgan pasa de 45 archivos a 25.
 *
 * Esta pieza no evalúa derechos: lo hace el orquestador, antes de llamarla y
 * antes de registrar nada, igual que `executeIngestionRun`. Tampoco espacia las
 * llamadas: recibe un `EgressFetch` ya espaciado por la raíz de composición.
 */
export const SEC_SOURCE_ID = "sec-edgar";

/**
 * Techo de archivos históricos por empresa: una corrida no recorre toda EDGAR.
 *
 * Medido el 2026-09-14 sobre el universo real. Un emisor industrial entra en uno
 * (Apple, NVIDIA, Berkshire, Realty Income). Los bancos que emiten notas
 * estructuradas presentan miles de `424B2` por año, así que su índice se parte en
 * muchos archivos y sus 10-K/10-Q quedan repartidos entre todos: JPMorgan necesita
 * 41, Goldman Sachs y Morgan Stanley 34, Citigroup 30, Bank of America 17. El
 * techo deja la mitad de margen sobre el peor caso medido y sigue cortando un
 * índice que creció fuera de toda escala. El presupuesto por corrida de la matriz
 * de cuotas (1.000 requests) se aplica aparte, en el espaciador.
 */
export const MAX_HISTORY_FILES_PER_COMPANY = 64;

/**
 * Peor caso de requests de una carga: submissions, companyfacts y el techo de
 * archivos históricos, que se comprueba **antes** de pedirlos. Un backfill no
 * empieza una empresa si el presupuesto de la corrida no cubre este número, así
 * que el presupuesto nunca se agota a mitad de un documento (ADR 0015).
 */
export const MAX_REQUESTS_PER_COMPANY_FACTS_LOAD =
  2 + MAX_HISTORY_FILES_PER_COMPANY;

export function buildSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${cik}.json`;
}

export function buildCompanyFactsUrl(cik: string): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
}

function buildHistoryUrl(name: string): string {
  return `https://data.sec.gov/submissions/${name}`;
}

/**
 * Archivos históricos que pueden contener una presentación con esa fecha.
 *
 * Los rangos que declara `filings.files` **no son contiguos**: medido el
 * 2026-09-14 sobre el CIK 19617, el archivo 015 termina el 2024-04-30 y el 014
 * empieza el 2024-05-02, y dos 10-Q fechados en esos huecos de un día no están
 * «cubiertos» por ningún rango aunque sí están en uno de los dos archivos. Por eso,
 * cuando ningún rango cubre la fecha, se piden los dos vecinos del hueco en vez
 * de dar la presentación por ausente y caer en la disponibilidad inferida.
 */
export function selectHistoryFiles(
  files: readonly SecSubmissionsHistoryFile[],
  filedDates: readonly string[],
): SecSubmissionsHistoryFile[] {
  const selected = new Set<SecSubmissionsHistoryFile>();

  for (const date of filedDates) {
    const covering = files.filter(
      (file) => date >= file.filingFrom && date <= file.filingTo,
    );

    if (covering.length > 0) {
      covering.forEach((file) => selected.add(file));
      continue;
    }

    const before = files
      .filter((file) => file.filingTo < date)
      .sort((left, right) => right.filingTo.localeCompare(left.filingTo))[0];
    const after = files
      .filter((file) => file.filingFrom > date)
      .sort((left, right) =>
        left.filingFrom.localeCompare(right.filingFrom),
      )[0];

    for (const neighbor of [before, after]) {
      if (neighbor !== undefined) {
        selected.add(neighbor);
      }
    }
  }

  // Orden estable del índice de la fuente: la corrida pide siempre lo mismo en el
  // mismo orden.
  return files.filter((file) => selected.has(file));
}

/** `429` y `5xx` son pasajeros; un `403` o un `404` no se arreglan reintentando. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

type Fetched = {
  readonly response: EgressFetchResponse;
  readonly text: string;
};

async function fetchDocument(
  fetch: EgressFetch,
  kind: CompanyFactsDocumentKind,
  url: string,
  allowNotFound = false,
): Promise<Fetched | null> {
  let response: EgressFetchResponse;

  try {
    response = await fetch({
      sourceId: SEC_SOURCE_ID,
      url,
      accept: "application/json",
    });
  } catch (cause) {
    // El mensaje del egress ya está escrito para no repetir destino ni query
    // (`TM-02`); igual pasa por la redacción al persistirse en la corrida.
    throw new CompanyFactsSourceError("fetch_failed", kind, {
      retryable: false,
      detail: cause instanceof Error ? cause.message : "egress failed",
    });
  }

  if (allowNotFound && response.status === 404) {
    return null;
  }

  if (response.status !== 200) {
    throw new CompanyFactsSourceError("unexpected_status", kind, {
      retryable: isRetryableStatus(response.status),
      detail: `status ${response.status}`,
    });
  }

  let text: string;

  try {
    // `fatal`: bytes que no son UTF-8 no se reemplazan por `�` y siguen de largo.
    text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
  } catch {
    throw new CompanyFactsSourceError("payload_schema_invalid", kind, {
      detail: "body is not valid utf-8",
    });
  }

  return { response, text };
}

function parseJson(kind: CompanyFactsDocumentKind, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CompanyFactsSourceError("payload_schema_invalid", kind, {
      detail: "payload is not valid json",
    });
  }
}

function describe(
  kind: CompanyFactsDocumentKind,
  url: string,
  fetched: Fetched,
  parserVersion: string,
): CompanyFactsDocument {
  return {
    kind,
    url,
    fetchedAt: fetched.response.fetchedAt,
    byteLength: fetched.response.byteLength,
    parserVersion,
  };
}

export function createLiveCompanyFactsSource(dependencies: {
  readonly fetch: EgressFetch;
}): CompanyFactsSource {
  const { fetch } = dependencies;

  return {
    async load(requestedCik: string): Promise<CompanyFactsDownload> {
      const cik = normalizeCik(requestedCik);

      if (cik === null) {
        // Un CIK inválido no es un fallo de la fuente: la URL ni se construye.
        throw new TypeError("The requested CIK is not a valid SEC CIK.");
      }

      const documents: CompanyFactsDocument[] = [];

      const submissionsUrl = buildSubmissionsUrl(cik);
      const submissionsFetched = (await fetchDocument(
        fetch,
        "submissions",
        submissionsUrl,
      ))!;
      const submissions = parseSecSubmissions(
        parseJson("submissions", submissionsFetched.text),
      );

      if (!submissions.ok) {
        throw new CompanyFactsSourceError(
          "payload_schema_invalid",
          "submissions",
          { detail: submissions.code },
        );
      }

      if (submissions.cik !== cik) {
        throw new CompanyFactsSourceError("subject_mismatch", "submissions");
      }

      documents.push(
        describe(
          "submissions",
          submissionsUrl,
          submissionsFetched,
          SEC_SUBMISSIONS_PARSER_VERSION,
        ),
      );

      const factsUrl = buildCompanyFactsUrl(cik);
      const factsFetched = await fetchDocument(
        fetch,
        "companyfacts",
        factsUrl,
        true,
      );

      if (factsFetched === null) {
        return {
          status: "no_company_facts",
          cik,
          fetchedAt: submissionsFetched.response.fetchedAt,
          documents,
        };
      }

      const companyFacts = parseSecCompanyFacts(
        factsFetched.text,
        isSelectedSecConcept,
      );

      if (!companyFacts.ok) {
        throw new CompanyFactsSourceError(
          "payload_schema_invalid",
          "companyfacts",
          { detail: companyFacts.code },
        );
      }

      if (companyFacts.cik !== cik) {
        throw new CompanyFactsSourceError("subject_mismatch", "companyfacts");
      }

      documents.push(
        describe(
          "companyfacts",
          factsUrl,
          factsFetched,
          SEC_COMPANY_FACTS_PARSER_VERSION,
        ),
      );

      const windowed = applySecHistoryWindow(
        companyFacts.facts,
        isSplitEvidenceConcept,
      );

      const known = new Set(
        [
          ...submissions.filings.map((filing) => filing.accessionNumber),
          ...submissions.rejections.map(
            (rejection) => rejection.accessionNumber,
          ),
        ].filter((accession): accession is string => accession !== null),
      );
      const missingFiledDates = [
        ...new Set(
          windowed.facts
            .filter((fact) => !known.has(fact.accessionNumber))
            .map((fact) => fact.filed),
        ),
      ];
      const neededFiles = selectHistoryFiles(
        submissions.historyFiles,
        missingFiledDates,
      );

      if (neededFiles.length > MAX_HISTORY_FILES_PER_COMPANY) {
        throw new CompanyFactsSourceError(
          "history_budget_exceeded",
          "submissions_history",
          { detail: `${neededFiles.length} files needed` },
        );
      }

      const filings: SecFiling[] = [...submissions.filings];
      const filingRejections: SecFilingRowRejection[] = [
        ...submissions.rejections,
      ];

      for (const file of neededFiles) {
        const url = buildHistoryUrl(file.name);
        const fetched = (await fetchDocument(
          fetch,
          "submissions_history",
          url,
        ))!;
        const history = parseSecFilingColumns(
          parseJson("submissions_history", fetched.text),
        );

        if (!history.ok) {
          throw new CompanyFactsSourceError(
            "payload_schema_invalid",
            "submissions_history",
            { detail: history.code },
          );
        }

        filings.push(...history.filings);
        filingRejections.push(...history.rejections);
        documents.push(
          describe(
            "submissions_history",
            url,
            fetched,
            SEC_SUBMISSIONS_PARSER_VERSION,
          ),
        );
      }

      return {
        status: "downloaded",
        cik,
        filings,
        filingRejections,
        facts: windowed.facts,
        factRejections: companyFacts.rejections,
        counts: companyFacts.counts,
        window: windowed.window,
        windowCounts: windowed.counts,
        fetchedAt: factsFetched.response.fetchedAt,
        documents,
      };
    },
  };
}
