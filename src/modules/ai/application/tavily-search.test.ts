import { describe, expect, it } from "vitest";

import type {
  EgressFetch,
  EgressFetchResponse,
} from "@/modules/ingestion/application/egress-fetch";

import {
  buildTavilyBody,
  classifyTavilyResponse,
  searchTavily,
  TAVILY_EXCERPT_CEILING_BYTES,
} from "./tavily-search";

const encode = (value: unknown) =>
  new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );

// Resultados sintéticos: ningún resultado real de búsqueda entra al repositorio.
const result = (overrides: Record<string, unknown> = {}) => ({
  url: "https://example.com/about",
  title: "Example Corp — About",
  content: "Example Corp sells enterprise software as a service.",
  score: 0.5,
  raw_content: null,
  id: "r-1",
  ...overrides,
});

describe("buildTavilyBody", () => {
  it("asks for excerpts only: no generated answer, raw page or images", () => {
    expect(buildTavilyBody("Example Corp primary business")).toEqual({
      query: "Example Corp primary business",
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    });
  });
});

describe("classifyTavilyResponse", () => {
  it("keeps the url as provenance and caps each excerpt", () => {
    const long = "x".repeat(TAVILY_EXCERPT_CEILING_BYTES + 200);
    const parsed = classifyTavilyResponse(
      200,
      encode({ results: [result(), result({ content: long })] }),
    );

    expect(parsed).toMatchObject({
      kind: "completed",
      results: [
        {
          url: "https://example.com/about",
          title: "Example Corp — About",
          truncated: false,
        },
        { truncated: true },
      ],
    });
    expect(
      parsed.kind === "completed" && parsed.results[1]!.excerpt.length,
    ).toBe(TAVILY_EXCERPT_CEILING_BYTES);
  });

  it("drops results without an https url or without content, and keeps five at most", () => {
    const parsed = classifyTavilyResponse(
      200,
      encode({
        results: [
          result({ url: "http://insecure.example.com" }),
          result({ url: "javascript:alert(1)" }),
          result({ content: "   " }),
          ...Array.from({ length: 8 }, (_, index) =>
            result({ url: `https://example.com/${index}` }),
          ),
        ],
      }),
    );

    expect(
      parsed.kind === "completed" && parsed.results.map((r) => r.url),
    ).toEqual([0, 1, 2, 3, 4].map((index) => `https://example.com/${index}`));
  });

  it("classifies the plan's limits as unauthorized and the rest by status", () => {
    expect(classifyTavilyResponse(432, encode({}))).toEqual({
      kind: "unauthorized",
      status: 432,
    });
    expect(classifyTavilyResponse(429, encode({})).kind).toBe("throttled");
    expect(classifyTavilyResponse(502, encode({})).kind).toBe("unavailable");
    expect(classifyTavilyResponse(400, encode({})).kind).toBe("rejected");
    expect(classifyTavilyResponse(200, encode("not json")).kind).toBe(
      "unreadable",
    );
    expect(classifyTavilyResponse(200, encode({ answer: "x" })).kind).toBe(
      "unreadable",
    );
  });
});

describe("searchTavily", () => {
  it("posts to the allowlisted endpoint and never carries the key itself", async () => {
    const requests: Parameters<EgressFetch>[0][] = [];
    const fetch: EgressFetch = async (request) => {
      requests.push(request);
      const body = encode({ results: [result()] });
      return {
        status: 200,
        body,
        byteLength: body.byteLength,
        fetchedAt: "2026-10-19T12:00:00.000Z",
        retryAfter: null,
        request,
      } as EgressFetchResponse;
    };

    await searchTavily(fetch, "Example Corp");

    expect(requests[0]).toMatchObject({
      sourceId: "tavily",
      url: "https://api.tavily.com/search",
      method: "POST",
    });
    expect(JSON.stringify(requests[0])).not.toMatch(/authorization|bearer/i);
  });
});
