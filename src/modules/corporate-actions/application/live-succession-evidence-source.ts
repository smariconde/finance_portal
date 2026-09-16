import {
  buildSubmissionsUrl,
  MAX_HISTORY_FILES_PER_COMPANY,
  SEC_SOURCE_ID,
} from "@/modules/fundamentals/application/live-company-facts-source";
import {
  normalizeCik,
  parseSecFilingColumns,
  parseSecSubmissions,
  SEC_SUBMISSIONS_PARSER_VERSION,
  type SecFiling,
  type SecFilingRowRejection,
  type SecSubmissionsHistoryFile,
} from "@/modules/fundamentals/domain/parse-sec-submissions";
import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";

import {
  isPeriodicReportForm,
  isSuccessionForm,
} from "../domain/verify-succession-evidence";
import {
  SuccessionEvidenceSourceError,
  type SecFilerDownload,
  type SuccessionEvidenceDocument,
  type SuccessionEvidenceSource,
} from "./succession-evidence-source";

/**
 * Evidencia de una sucesión desde la SEC: los índices de presentaciones de los
 * dos filers, y de sus archivos históricos sólo los que la verificación necesita.
 *
 * - **Sucesor**: la presentación citada y todo lo aceptado antes que ella. Si no
 *   está entre las recientes se recorren los archivos del más nuevo al más viejo
 *   hasta encontrarla, y después los que empiezan antes de su fecha de filing: un
 *   reporte periódico previo a la sucesión está ahí o no existe.
 * - **Antecesor**: basta con un reporte periódico conocible antes de la sucesión.
 *   Si no hay uno entre los recientes, se recorren los archivos hasta encontrarlo.
 *
 * Para ExxonMobil son dos requests: el sucesor tiene 29 presentaciones y el 10-K
 * del antecesor está entre sus mil recientes. El techo por empresa es el mismo que
 * el de companyfacts, y el ritmo lo pone el espaciador que recibe.
 */
function buildHistoryUrl(name: string): string {
  return `https://data.sec.gov/submissions/${name}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

type FilerCursor = {
  readonly cik: string;
  readonly entityName: string | null;
  readonly fetchedAt: string;
  readonly filings: SecFiling[];
  readonly filingRejections: SecFilingRowRejection[];
  /** Archivos históricos todavía no pedidos, del más nuevo al más viejo. */
  readonly pending: SecSubmissionsHistoryFile[];
};

export function createLiveSuccessionEvidenceSource(dependencies: {
  readonly fetch: EgressFetch;
}): SuccessionEvidenceSource {
  const { fetch } = dependencies;

  async function fetchJson(
    kind: SuccessionEvidenceDocument["kind"],
    url: string,
  ): Promise<{ response: EgressFetchResponse; payload: unknown }> {
    let response: EgressFetchResponse;

    try {
      response = await fetch({
        sourceId: SEC_SOURCE_ID,
        url,
        accept: "application/json",
      });
    } catch (cause) {
      throw new SuccessionEvidenceSourceError("fetch_failed", kind, {
        detail: cause instanceof Error ? cause.message : "egress failed",
      });
    }

    if (response.status !== 200) {
      throw new SuccessionEvidenceSourceError("unexpected_status", kind, {
        retryable: isRetryableStatus(response.status),
        detail: `status ${response.status}`,
      });
    }

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        response.body,
      );

      return { response, payload: JSON.parse(text) };
    } catch {
      throw new SuccessionEvidenceSourceError("payload_schema_invalid", kind, {
        detail: "payload is not valid utf-8 json",
      });
    }
  }

  return {
    async load(request) {
      const documents: SuccessionEvidenceDocument[] = [];
      let historyRequests = 0;

      const openFiler = async (requestedCik: string): Promise<FilerCursor> => {
        const cik = normalizeCik(requestedCik);

        if (cik === null) {
          throw new TypeError("The requested CIK is not a valid SEC CIK.");
        }

        const url = buildSubmissionsUrl(cik);
        const { response, payload } = await fetchJson("submissions", url);
        const parsed = parseSecSubmissions(payload);

        if (!parsed.ok) {
          throw new SuccessionEvidenceSourceError(
            "payload_schema_invalid",
            "submissions",
            { detail: parsed.code },
          );
        }

        if (parsed.cik !== cik) {
          throw new SuccessionEvidenceSourceError(
            "subject_mismatch",
            "submissions",
          );
        }

        documents.push({
          kind: "submissions",
          cik,
          url,
          fetchedAt: response.fetchedAt,
          byteLength: response.byteLength,
          parserVersion: SEC_SUBMISSIONS_PARSER_VERSION,
        });

        return {
          cik,
          entityName: parsed.entityName,
          fetchedAt: response.fetchedAt,
          filings: [...parsed.filings],
          filingRejections: [...parsed.rejections],
          pending: [...parsed.historyFiles].sort((left, right) =>
            right.filingTo.localeCompare(left.filingTo),
          ),
        };
      };

      const readHistory = async (
        filer: FilerCursor,
        file: SecSubmissionsHistoryFile,
      ): Promise<void> => {
        historyRequests += 1;

        if (historyRequests > MAX_HISTORY_FILES_PER_COMPANY) {
          throw new SuccessionEvidenceSourceError(
            "history_budget_exceeded",
            "submissions_history",
            { detail: `${historyRequests} files needed` },
          );
        }

        const url = buildHistoryUrl(file.name);
        const { response, payload } = await fetchJson(
          "submissions_history",
          url,
        );
        const history = parseSecFilingColumns(payload);

        if (!history.ok) {
          throw new SuccessionEvidenceSourceError(
            "payload_schema_invalid",
            "submissions_history",
            { detail: history.code },
          );
        }

        filer.filings.push(...history.filings);
        filer.filingRejections.push(...history.rejections);
        filer.pending.splice(filer.pending.indexOf(file), 1);
        documents.push({
          kind: "submissions_history",
          cik: filer.cik,
          url,
          fetchedAt: response.fetchedAt,
          byteLength: response.byteLength,
          parserVersion: SEC_SUBMISSIONS_PARSER_VERSION,
        });
      };

      const successor = await openFiler(request.successorCik);
      const findSuccession = () =>
        successor.filings.find(
          (filing) =>
            filing.accessionNumber === request.successionAccession &&
            isSuccessionForm(filing.form),
        ) ??
        successor.filings.find(
          (filing) => filing.accessionNumber === request.successionAccession,
        );

      while (findSuccession() === undefined && successor.pending.length > 0) {
        await readHistory(successor, successor.pending[0]!);
      }

      const succession = findSuccession();

      if (succession !== undefined) {
        for (const file of successor.pending.filter(
          (candidate) => candidate.filingFrom <= succession.filingDate,
        )) {
          await readHistory(successor, file);
        }
      }

      const predecessor = await openFiler(request.predecessorCik);

      if (succession !== undefined) {
        const hasPriorReport = () =>
          predecessor.filings.some(
            (filing) =>
              isPeriodicReportForm(filing.form) &&
              filing.filingDate <= succession.filingDate,
          );

        while (!hasPriorReport() && predecessor.pending.length > 0) {
          await readHistory(predecessor, predecessor.pending[0]!);
        }
      }

      const toDownload = (filer: FilerCursor): SecFilerDownload => ({
        cik: filer.cik,
        entityName: filer.entityName,
        filings: filer.filings,
        filingRejections: filer.filingRejections,
        fetchedAt: filer.fetchedAt,
      });

      return {
        successor: toDownload(successor),
        predecessor: toDownload(predecessor),
        documents,
      };
    },
  };
}
