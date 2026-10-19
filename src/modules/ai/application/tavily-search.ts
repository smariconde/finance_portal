import { z } from "zod";

import { truncateUtf8 } from "@/modules/fundamentals/domain/sec-10k-sections";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";

/**
 * Adaptador de búsqueda de Tavily (`F5-04`,
 * [ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisiones 2 y 6).
 *
 * Una búsqueda básica devuelve el extracto de cada resultado, así que el
 * proyecto **nunca baja una página**: la URL de un resultado se guarda como
 * procedencia y no se abre. Los parámetros del pedido están en el código —sin
 * respuesta generada, sin contenido crudo, sin imágenes—, y el adaptador no ve
 * la clave: la agrega la puerta de salida.
 */
export const TAVILY_SOURCE_ID = "tavily";
export const TAVILY_SEARCH_VERSION = "tavily-search-1.0.0";
export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/** Cinco resultados, como fija la ADR 0033: la búsqueda es un último recurso. */
export const TAVILY_MAX_RESULTS = 5;
/** Un extracto de búsqueda pesa ~1 kB; el techo acota uno anómalo. */
export const TAVILY_EXCERPT_CEILING_BYTES = 1_500;

export function buildTavilyBody(query: string): Record<string, unknown> {
  return {
    query,
    search_depth: "basic",
    max_results: TAVILY_MAX_RESULTS,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  };
}

export type WebSearchResult = {
  /** Procedencia: nunca se descarga. */
  readonly url: string;
  readonly title: string;
  readonly excerpt: string;
  readonly truncated: boolean;
};

const envelopeSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullable().optional(),
        content: z.string().nullable().optional(),
      }),
    )
    .max(50),
});

export type TavilySearchResult =
  | { readonly kind: "completed"; readonly results: readonly WebSearchResult[] }
  /** `401`, `403` y los límites del plan (`432`, `433`): frena la búsqueda. */
  | { readonly kind: "unauthorized"; readonly status: number }
  | { readonly kind: "throttled"; readonly status: number }
  | { readonly kind: "unavailable"; readonly status: number }
  | { readonly kind: "rejected"; readonly status: number }
  | { readonly kind: "unreadable"; readonly status: number };

/** Sólo un `https` con host pasa como procedencia; lo demás se descarta. */
function provenanceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function classifyTavilyResponse(
  status: number,
  body: Uint8Array,
): TavilySearchResult {
  if ([401, 403, 432, 433].includes(status)) {
    return { kind: "unauthorized", status };
  }
  if (status === 408 || status === 429) return { kind: "throttled", status };
  if (status >= 500) return { kind: "unavailable", status };
  if (status < 200 || status >= 300) return { kind: "rejected", status };

  let json: unknown;

  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return { kind: "unreadable", status };
  }

  const parsed = envelopeSchema.safeParse(json);

  if (!parsed.success) return { kind: "unreadable", status };

  const results: WebSearchResult[] = [];

  for (const result of parsed.data.results) {
    const url = provenanceUrl(result.url);
    const content = (result.content ?? "").trim();

    if (url === null || content.length === 0) continue;

    const cut = truncateUtf8(content, TAVILY_EXCERPT_CEILING_BYTES);

    results.push({
      url,
      title: (result.title ?? "").trim().slice(0, 300),
      excerpt: cut.text,
      truncated: cut.truncated,
    });

    if (results.length === TAVILY_MAX_RESULTS) break;
  }

  return { kind: "completed", results };
}

/** Una búsqueda. Los errores de la puerta suben tal cual: los clasifica el llamador. */
export async function searchTavily(
  fetch: EgressFetch,
  query: string,
): Promise<TavilySearchResult> {
  const response = await fetch({
    sourceId: TAVILY_SOURCE_ID,
    url: TAVILY_SEARCH_URL,
    method: "POST",
    body: new TextEncoder().encode(JSON.stringify(buildTavilyBody(query))),
    contentType: "application/json",
  });

  return classifyTavilyResponse(response.status, response.body);
}
