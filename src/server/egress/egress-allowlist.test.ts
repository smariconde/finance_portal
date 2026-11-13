import { describe, expect, it } from "vitest";

import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { DAMODARAN_COUNTRY_RISK_WORKBOOK } from "@/modules/reference-data/domain/damodaran-datasets";
import {
  findEgressAllowlistEntry,
  listEgressAllowlistEntries,
} from "@/server/egress/egress-allowlist";
import { authorizeEgressUrl } from "@/server/egress/egress-policy";

describe("egress allowlist", () => {
  it("holds only sources that a delivered slice needs", () => {
    // La allowlist no se escribe por adelantado. Cada fila de más es un destino
    // alcanzable que ningún test ejercita.
    expect(listEgressAllowlistEntries().map((entry) => entry.sourceId)).toEqual(
      [
        "sec-edgar",
        "datahub-sp500-pddl",
        "yahoo-finance",
        "comafi-cedear",
        "caja-valores-cedear",
        "bcra-itcrm-xlsx",
        "bcra-rem-release",
        "bcra-monetarias-v4",
        "bcra-cambiarias-v1",
        "argentina-series-tiempo",
        "indec-api",
        "bcr-cac-pizarra",
        "bna-fx",
        "magyp-estimaciones",
        "magyp-datos-abiertos",
        "damodaran-current-data",
        "openrouter",
        "tavily",
      ],
    );
  });

  it("opens only the official ITCRM workbook on the BCRA site", () => {
    const source = findEgressAllowlistEntry("bcra-itcrm-xlsx")!;
    expect(
      authorizeEgressUrl(
        "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/itcrm-serie.xlsx",
        source,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeEgressUrl(
        "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/otra-serie.xlsx",
        source,
      ).allowed,
    ).toBe(false);
  });

  it("limits REM egress to the verified October page and workbook", () => {
    const source = findEgressAllowlistEntry("bcra-rem-release")!;
    expect(source.maxRedirects).toBe(0);
    for (const url of [
      "https://www.bcra.gob.ar/publicaciones/relevamiento-de-expectativas-de-mercado-rem-octubre-de-2026/",
      "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-2026-10.xlsx",
    ])
      expect(authorizeEgressUrl(url, source).allowed).toBe(true);
    expect(
      authorizeEgressUrl(
        "https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-2026-09.xlsx",
        source,
      ).allowed,
    ).toBe(false);
  });

  it("limits Argentina Series access to the series endpoint", () => {
    const series = findEgressAllowlistEntry("argentina-series-tiempo")!;
    expect(series.method).toBe("GET");
    expect(series.maxRedirects).toBe(0);
    expect(
      authorizeEgressUrl(
        "https://apis.datos.gob.ar/series/api/series/?ids=74.3_IET_0_M_16&start=0&limit=1000",
        series,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeEgressUrl(
        "https://apis.datos.gob.ar/series/api/search/?q=fiscal",
        series,
      ).allowed,
    ).toBe(false);
    expect(
      authorizeEgressUrl(
        "https://datos.gob.ar/series/api/series/?ids=74.3_IET_0_M_16",
        series,
      ).allowed,
    ).toBe(false);
  });

  it("opens only the currency master and quotes of Estadísticas Cambiarias", () => {
    // ADR 0067: un prefijo por recurso; las cotizaciones por fecha quedan fuera.
    const fx = findEgressAllowlistEntry("bcra-cambiarias-v1")!;

    expect(fx.identification).toBe("project");
    expect(fx.credential).toBeNull();
    expect(fx.maxRedirects).toBe(0);

    for (const url of [
      "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Maestros/Divisas",
      "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=1992-01-02&fechahasta=2026-11-02&limit=1000&offset=0",
    ]) {
      expect(authorizeEgressUrl(url, fx).allowed).toBe(true);
    }

    for (const url of [
      "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones?fecha=2026-10-30",
      "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias",
      "https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/20123456789",
    ]) {
      expect(authorizeEgressUrl(url, fx).allowed).toBe(false);
    }
  });

  it("opens only Estadísticas Monetarias v4 on the BCRA host, as the project", () => {
    // ADR 0065: el mismo host sirve otras APIs y las versiones deprecadas.
    const bcra = findEgressAllowlistEntry("bcra-monetarias-v4")!;

    expect(bcra.method).toBe("GET");
    expect(bcra.identification).toBe("project");
    expect(bcra.credential).toBeNull();
    expect(bcra.maxRedirects).toBe(0);

    for (const url of [
      "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?offset=0&limit=1000",
      "https://api.bcra.gob.ar/estadisticas/v4.0/Metodologia?offset=0&limit=250",
      "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/30?offset=0&limit=3000",
    ]) {
      expect(authorizeEgressUrl(url, bcra).allowed).toBe(true);
    }

    for (const url of [
      "https://api.bcra.gob.ar/estadisticas/v3.0/monetarias",
      "https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/20123456789",
      "https://www.bcra.gob.ar/aviso-legal/",
    ]) {
      expect(authorizeEgressUrl(url, bcra).allowed).toBe(false);
    }
  });

  it("reaches the model and the search engine only by POST, with a credential the door adds", () => {
    // ADR 0033: un endpoint exacto por fuente, sin redirects, y la credencial
    // declarada por nombre de variable. El valor no vive en la allowlist.
    const openrouter = findEgressAllowlistEntry("openrouter")!;
    const tavily = findEgressAllowlistEntry("tavily")!;

    for (const entry of [openrouter, tavily]) {
      expect(entry.method).toBe("POST");
      expect(entry.identification).toBe("project");
      expect(entry.maxRedirects).toBe(0);
      expect(entry.credential?.header).toBe("authorization");
    }

    expect(openrouter.credential?.variable).toBe("OPENROUTER_API_KEY");
    expect(tavily.credential?.variable).toBe("TAVILY_API_KEY");
    expect(
      authorizeEgressUrl(
        "https://openrouter.ai/api/v1/chat/completions",
        openrouter,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeEgressUrl("https://api.tavily.com/search", tavily).allowed,
    ).toBe(true);

    for (const url of [
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/keys",
      "https://openrouter.ai/api/v1/credits",
    ]) {
      expect(authorizeEgressUrl(url, openrouter).allowed).toBe(false);
    }

    for (const url of [
      "https://api.tavily.com/extract",
      "https://api.tavily.com/crawl",
    ]) {
      expect(authorizeEgressUrl(url, tavily).allowed).toBe(false);
    }
  });

  it("keeps every data source on GET, with a credential only where the source demands one", () => {
    for (const entry of listEgressAllowlistEntries()) {
      if (entry.sourceId === "openrouter" || entry.sourceId === "tavily") {
        continue;
      }
      // Estimaciones Agrícolas answers a form, not a URL (ADR 0071).
      if (entry.sourceId === "magyp-estimaciones") {
        expect(entry.method).toBe("POST");
        expect(entry.credential).toBeNull();
        expect(entry.maxRedirects).toBe(0);
        continue;
      }

      expect(entry.method).toBe("GET");
      expect(entry.maxRequestBytes).toBe(0);
      if (entry.sourceId === "indec-api") {
        expect(entry.credential?.variable).toBe("INDEC_API_TOKEN");
      } else {
        expect(entry.credential).toBeNull();
      }
    }
  });

  it("reaches only the one resource each soy source publishes", () => {
    // ADR 0071: each host serves far more than the series the portal reads.
    const cases: readonly (readonly [string, string, readonly string[]])[] = [
      [
        "bcr-cac-pizarra",
        "https://www.cac.bcr.com.ar/es/api/prices/987/export?product=13&type=pizarra&date_start=2000-01-01&date_end=2026-11-04&period=day",
        [
          "https://www.cac.bcr.com.ar/es/precios-de-pizarra/consultas",
          "https://www.bcr.com.ar/es/mercados",
        ],
      ],
      [
        "bna-fx",
        "https://www.bna.com.ar/Cotizador/DescargarPorFecha?idMonedaDescarga=55&fechaDesde=01%2F01%2F2000&fechaHasta=04%2F11%2F2026&id=monedas",
        [
          "https://www.bna.com.ar/Personas",
          "https://www.bna.com.ar/Cotizador/MonedasHistorico",
        ],
      ],
      [
        "magyp-estimaciones",
        "https://datosestimaciones.magyp.gob.ar/reportes.php?reporte=Estimaciones",
        ["https://datosestimaciones.magyp.gob.ar/ajax/getProvincias.php"],
      ],
      [
        "magyp-datos-abiertos",
        "https://datos.magyp.gob.ar/dataset/8ae4865f-d2f2-45a2-9343-7a4a12728a90/resource/3bfe4630-91e2-46cd-82ad-cf8dc94d3dfb/download/soja-serie-1941-2024-anual.csv",
        ["https://datos.magyp.gob.ar/api/3/action/package_show?id=soja"],
      ],
    ];
    for (const [sourceId, allowed, refused] of cases) {
      const entry = findEgressAllowlistEntry(sourceId)!;
      expect(entry.identification).toBe("project");
      expect(authorizeEgressUrl(allowed, entry).allowed).toBe(true);
      for (const url of refused) {
        expect(authorizeEgressUrl(url, entry).allowed).toBe(false);
      }
    }
  });

  it("reads the declared INDEC services with the owner's token and nothing else on that host", () => {
    // ADR 0069: el token del INDEC sale sólo hacia sus servicios de datos; el
    // portal, su login y el catálogo no se alcanzan.
    const indec = findEgressAllowlistEntry("indec-api")!;
    expect(indec.identification).toBe("project");
    expect(indec.maxRedirects).toBe(0);
    expect(
      authorizeEgressUrl(
        "https://api.indec.gob.ar/v1/estimador-mensual-de-actividad-economica-nivel-general?limit=1000&offset=0",
        indec,
      ).allowed,
    ).toBe(true);
    for (const service of [
      "ipc_nacional",
      "valorizacion_canastas_cba_cbt",
      "ipi_manufacturero",
      "ipi_minero",
      "sipm_precios_mayoristas",
      "icc_precios_construccion",
      "indice_salarios",
    ]) {
      expect(
        authorizeEgressUrl(
          `https://api.indec.gob.ar/v1/${service}?limit=1000&offset=0`,
          indec,
        ).allowed,
      ).toBe(true);
    }
    for (const url of [
      "https://api.indec.gob.ar/api/datasets",
      "https://api.indec.gob.ar/api/auth/me",
      "https://api.indec.gob.ar/v1/ipi_pesquero",
      "https://www.indec.gob.ar/v1/comercio_exterior_exportacion_bienes",
    ]) {
      expect(authorizeEgressUrl(url, indec).allowed).toBe(false);
    }
  });

  it("reaches the seven Damodaran files one by one, never the whole site", () => {
    const entry = findEgressAllowlistEntry("damodaran-current-data");

    expect(entry?.origins).toEqual([
      {
        host: "pages.stern.nyu.edu",
        pathPrefixes: [
          "/~adamodar/New_Home_Page/datafile/Betas.html",
          "/~adamodar/pc/datasets/ctrypremJuly26.xlsx",
          "/~adamodar/pc/fcffsimpleginzu.xlsx",
          "/~adamodar/New_Home_Page/datafile/histimpl.html",
          "/~adamodar/New_Home_Page/datafile/ratings.html",
          "/~adamodar/New_Home_Page/datafile/EVA.html",
          "/~adamodar/New_Home_Page/datafile/margin.html",
        ],
      },
    ]);
    expect(entry?.maxRedirects).toBe(0);
    // El pin del libro vive con los datasets: la allowlist abre esa ruta y
    // ninguna otra del directorio (ADR 0034).
    expect(entry?.origins[0]?.pathPrefixes).toContain(
      new URL(DAMODARAN_COUNTRY_RISK_WORKBOOK.url).pathname,
    );
  });

  it("returns null for a source that is not listed, with no default", () => {
    expect(findEgressAllowlistEntry("alpaca-market-data")).toBeNull();
    expect(findEgressAllowlistEntry("")).toBeNull();
  });

  it("names every allowlisted source in the source registry too", () => {
    // Las dos listas responden preguntas distintas —a dónde se puede abrir un
    // socket, y de qué se tiene derecho a ingerir— pero una fuente que sólo
    // existe en una de las dos es un descuido en cualquiera de los dos sentidos.
    const registered = new Set(
      DEMO_SOURCE_REGISTRY.map((entry) => entry.sourceId),
    );

    for (const entry of listEgressAllowlistEntries()) {
      expect(registered).toContain(entry.sourceId);
    }
  });

  it("carries no rights information, so being listed cannot express permission", () => {
    // El punto de tener dos controles es que ninguno pueda cubrir al otro, y acá
    // eso es estructural: una entrada de allowlist no tiene dónde escribir un
    // derecho. Responde "¿a dónde se puede abrir un socket?" y nada más.
    for (const entry of listEgressAllowlistEntries()) {
      expect(Object.keys(entry).sort()).toEqual([
        "credential",
        "deadlineMs",
        "identification",
        "maxRedirects",
        "maxRequestBytes",
        "maxResponseBytes",
        "method",
        "origins",
        "sourceId",
      ]);
    }
  });

  it("leaves an approved source unreachable when it is not listed", () => {
    // El recíproco del caso anterior: `alpaca-market-data` está registrada y aun
    // así no se alcanza, porque la aprobación de derechos no agrega destinos.
    const registered = DEMO_SOURCE_REGISTRY.map((entry) => entry.sourceId);

    expect(registered).toContain("alpaca-market-data");
    expect(findEgressAllowlistEntry("alpaca-market-data")).toBeNull();
  });

  it("records that both allowlisted sources passed the owner's rights review", () => {
    // Aprobadas el 2026-09-05. Se afirma acá para que quitarle los derechos a una
    // fuente y dejarla alcanzable sea un cambio visible y no una omisión.
    for (const sourceId of ["sec-edgar", "datahub-sp500-pddl"]) {
      const entry = DEMO_SOURCE_REGISTRY.find(
        (candidate) => candidate.sourceId === sourceId,
      );

      expect(entry?.approvalStatus).toBe("approved_personal");
      expect(entry?.rights.automatedAccess).toBe("allowed");
      expect(entry?.rightsReviewedAt).not.toBeNull();
    }
  });

  it("keeps each source's raw storage right at whatever was actually reviewed", () => {
    // El gate pide sólo lo que el adaptador usa, así que una fila se revisa de
    // nuevo recién cuando algo necesita un derecho que decía `unknown`. Las dos
    // fuentes alcanzables divergen justo ahí, y la divergencia se afirma para que
    // conceder un derecho por arrastre no pase inadvertido.
    const findRights = (sourceId: string) =>
      DEMO_SOURCE_REGISTRY.find((entry) => entry.sourceId === sourceId)?.rights;

    // ADR 0023: los extractos congelados obligaron a contestar por `sec-edgar`.
    expect(findRights("sec-edgar")?.rawStorage).toBe("allowed");
    expect(findRights("sec-edgar")?.publicDisplay).toBe("allowed");
    // ADR 0033: mandar un extracto a un modelo es copiarlo, y la SEC autoriza
    // copiar con cita. Se contestó cuando apareció el receptor.
    expect(findRights("sec-edgar")?.aiTransfer).toBe("allowed");

    // El universo se persiste normalizado y derivado; nadie guardó su payload.
    expect(findRights("datahub-sp500-pddl")?.rawStorage).toBe("unknown");
  });

  it("records that Yahoo was accepted by the owner and never granted", () => {
    // Es la distinción que la ADR 0026 agregó al vocabulario, y se afirma acá
    // para que nadie la borre "simplificando" a `allowed`: `allowed` significa
    // que una fuente primaria cubre el uso, y Yahoo no cubre ninguno.
    const entry = DEMO_SOURCE_REGISTRY.find(
      (candidate) => candidate.sourceId === "yahoo-finance",
    );

    expect(entry?.approvalStatus).toBe("approved_personal");
    expect(entry?.rights.personalUse).toBe("owner_accepted");
    expect(entry?.rights.automatedAccess).toBe("owner_accepted");
    expect(entry?.rights.normalizedStorage).toBe("owner_accepted");
    // Ninguno de estos es `allowed`: nadie los concedió.
    expect(entry?.rights.automatedAccess).not.toBe("allowed");
    // Y una decisión del owner no alcanza para una superficie pública.
    expect(entry?.rights.publicDisplay).toBe("restricted");
    expect(entry?.rights.rawStorage).toBe("restricted");
  });

  it("records that both CEDEAR issuers were accepted by the owner and never granted", () => {
    // ADR 0027. Comafi prohíbe almacenar por escrito y Caja de Valores no
    // publica términos: ninguno concede, así que ninguno puede decir `allowed`.
    for (const sourceId of ["comafi-cedear", "caja-valores-cedear"]) {
      const entry = DEMO_SOURCE_REGISTRY.find(
        (candidate) => candidate.sourceId === sourceId,
      );

      expect(entry?.approvalStatus).toBe("approved_personal");
      expect(entry?.rights.automatedAccess).toBe("owner_accepted");
      expect(entry?.rights.normalizedStorage).toBe("owner_accepted");
      expect(entry?.rights.rawStorage).toBe("restricted");
      expect(entry?.rights.publicDisplay).toBe("restricted");
    }
  });

  it("authorizes the declared CEDEAR publications and no neighboring paths", () => {
    const comafi = findEgressAllowlistEntry("comafi-cedear")!;
    const caja = findEgressAllowlistEntry("caja-valores-cedear")!;

    expect(
      authorizeEgressUrl(
        "https://www.comafi.com.ar/custodiaglobal/json/apps/getproducts.aspx",
        comafi,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeEgressUrl("https://cajadevalores.com.ar/Servicios/Cedears", caja)
        .allowed,
    ).toBe(true);

    expect(
      authorizeEgressUrl(
        "https://www.comafi.com.ar/custodiaglobal/Multimedios/otros/14779.xlsx",
        comafi,
      ).allowed,
    ).toBe(true);
    for (const url of [
      "https://www.comafi.com.ar/custodiaglobal/json/apps/getfiles.aspx?Category=1",
      "https://www.comafi.com.ar/custodiaglobal/Multimedios/otros/99999.xlsx",
      "https://hb.comafi.com.ar/",
    ]) {
      expect(authorizeEgressUrl(url, comafi).allowed).toBe(false);
    }

    for (const url of [
      "https://cajadevalores.com.ar/Tramites/Index",
      "https://inversores.cajadevalores.com.ar/",
    ]) {
      expect(authorizeEgressUrl(url, caja).allowed).toBe(false);
    }
  });

  it("authorizes one Yahoo chart path and nothing else on that host", () => {
    const entry = findEgressAllowlistEntry("yahoo-finance");

    expect(entry).not.toBeNull();
    expect(
      authorizeEgressUrl(
        "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5y&interval=1d",
        entry!,
      ).allowed,
    ).toBe(true);

    for (const url of [
      "https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL",
      "https://query1.finance.yahoo.com/v1/finance/search?q=apple",
      "https://query2.finance.yahoo.com/v8/finance/chart/AAPL",
      "https://finance.yahoo.com/quote/AAPL",
    ]) {
      expect(authorizeEgressUrl(url, entry!).allowed).toBe(false);
    }
  });

  it("authorizes the SEC endpoints that Phase 2 needs", () => {
    const entry = findEgressAllowlistEntry("sec-edgar");

    expect(entry).not.toBeNull();

    for (const url of [
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      "https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json",
      "https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2024Q1I.json",
      "https://data.sec.gov/submissions/CIK0000320193.json",
      "https://www.sec.gov/files/company_tickers.json",
      "https://www.sec.gov/files/company_tickers_exchange.json",
      // F5-03: el documento principal de un 10-K.
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
    ]) {
      expect(authorizeEgressUrl(url, entry!).allowed).toBe(true);
    }
  });

  it("leaves the rest of the SEC site unreachable", () => {
    const entry = findEgressAllowlistEntry("sec-edgar")!;

    for (const url of [
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany",
      "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/",
      "https://www.sec.gov/Archives/edgar/full-index/company.idx",
      "https://efts.sec.gov/LATEST/search-index?q=test",
      "https://data.sec.gov/api/xbrl/",
    ]) {
      expect(authorizeEgressUrl(url, entry).allowed).toBe(false);
    }
  });
});
