import { describe, expect, it } from "vitest";

import {
  authorizeEgressUrl,
  egressAllowlistEntrySchema,
  MAX_EGRESS_URL_LENGTH,
  type EgressAllowlistEntry,
  type EgressRejectionCode,
} from "@/server/egress/egress-policy";

const ENTRY: EgressAllowlistEntry = egressAllowlistEntrySchema.parse({
  sourceId: "sec-edgar",
  origins: [
    {
      host: "data.sec.gov",
      pathPrefixes: ["/api/xbrl/companyfacts/", "/submissions/"],
    },
    {
      host: "www.sec.gov",
      pathPrefixes: ["/files/company_tickers_exchange.json"],
    },
  ],
  maxResponseBytes: 1024 * 1024,
  deadlineMs: 30_000,
  maxRedirects: 2,
});

function expectRejection(rawUrl: string, code: EgressRejectionCode): void {
  const authorization = authorizeEgressUrl(rawUrl, ENTRY);

  expect(authorization.allowed).toBe(false);
  expect(authorization.allowed ? null : authorization.code).toBe(code);
}

describe("authorizeEgressUrl", () => {
  it("authorizes a URL whose host and path prefix are both allowlisted", () => {
    const authorization = authorizeEgressUrl(
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      ENTRY,
    );

    expect(authorization.allowed).toBe(true);
    expect(authorization.allowed && authorization.target).toBe(
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
    );
  });

  it("pairs host with path prefix instead of allowing any prefix on any host", () => {
    // Los dos hosts de la SEC no sirven los mismos recursos. Una allowlist que
    // cruzara hosts y prefijos dejaría pedir `/submissions/` en `www.sec.gov`.
    expectRejection(
      "https://www.sec.gov/submissions/CIK0000320193.json",
      "path_not_allowlisted",
    );
    expectRejection(
      "https://data.sec.gov/files/company_tickers_exchange.json",
      "path_not_allowlisted",
    );
  });

  it("refuses anything that is not HTTPS", () => {
    expectRejection(
      "http://data.sec.gov/submissions/CIK0000320193.json",
      "scheme_not_https",
    );
    expectRejection("file:///etc/passwd", "scheme_not_https");
    expectRejection("gopher://data.sec.gov/1", "scheme_not_https");
  });

  it("refuses a userinfo prefix that impersonates an allowlisted host", () => {
    // `https://data.sec.gov@attacker.example/` parsea con host
    // `attacker.example`: le miente al lector, no al parser.
    expectRejection(
      "https://data.sec.gov@attacker.example/submissions/x.json",
      "url_contains_credentials",
    );
    expectRejection(
      "https://user:pass@data.sec.gov/submissions/x.json",
      "url_contains_credentials",
    );
  });

  it("refuses a host that only looks allowlisted", () => {
    expectRejection(
      "https://data.sec.gov.attacker.example/submissions/x.json",
      "host_not_allowlisted",
    );
    expectRejection(
      "https://evil-data.sec.gov.co/submissions/x.json",
      "host_not_allowlisted",
    );
    expectRejection(
      "https://sec.gov/submissions/x.json",
      "host_not_allowlisted",
    );
  });

  it("normalizes case and the root dot before comparing the host", () => {
    // `DATA.SEC.GOV.` y `data.sec.gov` son el mismo host; ninguna de las dos
    // formas debe poder esquivar la comparación en un sentido ni en el otro.
    for (const host of ["DATA.SEC.GOV", "data.sec.gov.", "Data.Sec.Gov."]) {
      expect(
        authorizeEgressUrl(`https://${host}/submissions/x.json`, ENTRY).allowed,
      ).toBe(true);
    }
  });

  it("refuses an IP literal as host", () => {
    // Un literal no pasa por la resolución, que es donde se validan las
    // direcciones. Las fuentes aprobadas se nombran, no se numeran.
    expectRejection(
      "https://127.0.0.1/submissions/x.json",
      "host_is_ip_literal",
    );
    expectRejection("https://[::1]/submissions/x.json", "host_is_ip_literal");
    expectRejection(
      "https://169.254.169.254/submissions/x.json",
      "host_is_ip_literal",
    );
  });

  it("refuses an explicit port other than 443", () => {
    expectRejection(
      "https://data.sec.gov:8443/submissions/x.json",
      "port_not_allowed",
    );
    expect(
      authorizeEgressUrl("https://data.sec.gov:443/submissions/x.json", ENTRY)
        .allowed,
    ).toBe(true);
  });

  it("compares the prefix against the path that URL already resolved", () => {
    // `/submissions/../secret` colapsa a `/secret` antes de compararse, así que
    // el prefijo no se puede esquivar con segmentos relativos.
    expectRejection(
      "https://data.sec.gov/submissions/../cgi-bin/browse-edgar",
      "path_not_allowlisted",
    );
    expectRejection(
      "https://data.sec.gov/submissions/../../etc/passwd",
      "path_not_allowlisted",
    );
  });

  it("refuses a percent-encoded traversal, because URL decodes the dot segments too", () => {
    // `%2e` y `%2E` son puntos para el parser de la WHATWG: `/submissions/%2e%2e/x`
    // colapsa a `/x` antes de compararse. La codificación no compra un segundo
    // significado.
    expectRejection(
      "https://data.sec.gov/submissions/%2e%2e/%2e%2e/etc/passwd",
      "path_not_allowlisted",
    );
    expectRejection(
      "https://data.sec.gov/submissions/%2E%2E/cgi-bin/browse-edgar",
      "path_not_allowlisted",
    );
  });

  it("keeps an encoded slash inside the prefix instead of reading it as a separator", () => {
    // `%2f` **no** es separador y `URL` no lo colapsa. El path sigue bajo el
    // prefijo y la SEC recibe exactamente la cadena que se autorizó: cliente y
    // servidor leen el mismo destino, que es la propiedad que importa.
    const authorization = authorizeEgressUrl(
      "https://data.sec.gov/submissions/..%2fcgi-bin/browse-edgar",
      ENTRY,
    );

    expect(authorization.allowed).toBe(true);
    expect(authorization.allowed && authorization.url.pathname).toBe(
      "/submissions/..%2fcgi-bin/browse-edgar",
    );
  });

  it("refuses unparsable and oversized URLs", () => {
    expectRejection("not a url", "url_unparsable");
    expectRejection(
      `https://data.sec.gov/submissions/${"a".repeat(MAX_EGRESS_URL_LENGTH)}`,
      "url_too_long",
    );
  });

  it("keeps the query out of the loggable target", () => {
    // La query es donde viajaría una key. El destino que se puede loguear se
    // corta en el path (`TM-02`).
    const authorization = authorizeEgressUrl(
      "https://data.sec.gov/api/xbrl/companyfacts/CIK1.json?token=secreto",
      ENTRY,
    );

    expect(authorization.allowed && authorization.target).toBe(
      "https://data.sec.gov/api/xbrl/companyfacts/CIK1.json",
    );
    expect(authorization.allowed && authorization.target).not.toContain(
      "secreto",
    );
  });
});

describe("egressAllowlistEntrySchema", () => {
  it("refuses an entry with no origin, so an empty allowlist cannot mean 'anything'", () => {
    expect(
      egressAllowlistEntrySchema.safeParse({ ...ENTRY, origins: [] }).success,
    ).toBe(false);
  });

  it("refuses a host that is not already normalized", () => {
    for (const host of ["DATA.SEC.GOV", "data.sec.gov.", "data.sec.gov:443"]) {
      expect(
        egressAllowlistEntrySchema.safeParse({
          ...ENTRY,
          origins: [{ host, pathPrefixes: ["/"] }],
        }).success,
      ).toBe(false);
    }
  });

  it("refuses a path prefix that is relative or carries a traversal", () => {
    for (const prefix of ["api/", "/submissions/../"]) {
      expect(
        egressAllowlistEntrySchema.safeParse({
          ...ENTRY,
          origins: [{ host: "data.sec.gov", pathPrefixes: [prefix] }],
        }).success,
      ).toBe(false);
    }
  });
});
