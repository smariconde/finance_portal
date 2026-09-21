import {
  assertGateSample,
  gateSampleEntrySchema,
  type GateSampleEntry,
} from "../domain/gate-reconciliation-sample";

const DECIDED_ON = "2026-09-21";

function declare(
  ticker: string,
  archetype: GateSampleEntry["archetype"],
  batch: number,
  rationale: string,
): GateSampleEntry {
  return gateSampleEntrySchema.parse({
    ticker,
    archetype,
    batch,
    decidedBy: "owner",
    decidedOn: DECIDED_ON,
    rationale,
  });
}

/**
 * Las treinta empresas del gate de la Fase 2, declaradas por el owner.
 *
 * La tanda 1 son los seis filers que ya tenían fundamentals publicados más siete
 * elegidos para que la tanda cubra los diez arquetipos: sobre ella se mide qué
 * cuesta reconciliar una empresa de verdad antes de comprometer el resto.
 *
 * Dos límites declarados y no disimulados: el S&P 500 tiene pocos holdings puros
 * y, por construcción, expulsa a las empresas en distress, así que esos dos
 * arquetipos llegan a dos empresas y no a tres. La diferencia se compensa con
 * una cuarta empresa madura y una cuarta de commodity, donde más reconciliación
 * agrega evidencia.
 */
export const DECLARED_GATE_SAMPLE: readonly GateSampleEntry[] = Object.freeze(
  assertGateSample([
    // No financiera madura — FCFF estable o dos etapas.
    declare(
      "AAPL",
      "mature_non_financial",
      1,
      "Ya ingerida y reconciliada contra su 10-K en F2-06. Es la referencia con la que se comparan las demás: margen estable, recompras grandes y dos splits registrados.",
    ),
    declare(
      "GOOGL",
      "mature_non_financial",
      1,
      "Ya ingerida. Aporta el split 20:1 de 2022 y una estructura de clases de acciones que el modelo de identidad tiene que sostener sin fusionar instrumentos.",
    ),
    declare(
      "DUK",
      "mature_non_financial",
      1,
      "Ya ingerida. Utility regulada: la tabla de arquetipos no tiene uno propio para utilities y su método cae acá, pero su base de activos regulada la distingue de una industrial.",
    ),
    declare(
      "JNJ",
      "mature_non_financial",
      2,
      "Farmacéutica madura con escisión reciente de consumo: pone a prueba que una separación no se confunda con una caída de ingresos.",
    ),

    // Alto crecimiento — FCFF tres etapas.
    declare(
      "NVDA",
      "high_growth",
      1,
      "Ya ingerida. Aporta los dos splits (4:1 y 10:1) y el cambio de escala más violento del índice, que es donde una ventana de cinco ejercicios se nota.",
    ),
    declare(
      "AMZN",
      "high_growth",
      2,
      "Crecimiento con segmentos de márgenes muy distintos: el consolidado esconde AWS, que es el caso que el arquetipo tiene que poder separar.",
    ),
    declare(
      "CRM",
      "high_growth",
      2,
      "Software con adquisiciones grandes y una diferencia marcada entre resultado reportado y ajustado, que es lo que F4-03 va a normalizar.",
    ),

    // Pérdidas / early stage — revenue-to-margin y probabilidad de supervivencia.
    declare(
      "MRNA",
      "loss_making_early_stage",
      1,
      "Pasó de ingresos extraordinarios a pérdidas dentro de la ventana: es el caso donde el último ejercicio como run-rate da cualquier cosa y el valor no puede salir de un P/E.",
    ),
    declare(
      "CRL",
      "loss_making_early_stage",
      2,
      "Servicios de investigación con deterioros que hunden el resultado sin tocar la caja: separa la pérdida contable de la económica.",
    ),
    declare(
      "INCY",
      "loss_making_early_stage",
      2,
      "Biotecnología con resultado que cruza el cero dentro de la ventana, lo que prueba que un valor negativo no se normaliza ni se descarta.",
    ),

    // Banco — excess return o DDM.
    declare(
      "JPM",
      "bank",
      1,
      "El banco más grande del índice. Se elige para el gate porque sus conceptos XBRL son los que la selección sec-core-concepts probablemente no cubra: qué falta es el hallazgo buscado.",
    ),
    declare(
      "BAC",
      "bank",
      2,
      "Segundo banco para confirmar que lo que falte en JPM es de la selección de conceptos y no de ese filer en particular.",
    ),
    declare(
      "USB",
      "bank",
      2,
      "Banco regional: estructura más simple que la de un banco universal, así que separa lo que falta por tamaño de lo que falta por ser banco.",
    ),

    // Aseguradora — excess return o DDM, con reservas que no son deuda normal.
    declare(
      "PGR",
      "insurer",
      1,
      "Aseguradora de daños pura, sin banca ni gestión de activos encima: el caso más limpio para ver si las reservas técnicas llegan a la base.",
    ),
    declare(
      "TRV",
      "insurer",
      2,
      "Otra de daños, con serie larga de combined ratio, que es el cross-check que el arquetipo declara.",
    ),
    declare(
      "AFL",
      "insurer",
      2,
      "Aseguradora de vida y salud con exposición en yenes: agrega el caso de moneda, que el contrato exige no mezclar al comparar.",
    ),

    // REIT — AFFO, FCFE o DDM.
    declare(
      "PLD",
      "reit",
      1,
      "REIT industrial grande: la depreciación distorsiona el resultado contable, que es justamente lo que el AFFO corrige y un FCF industrial arruinaría.",
    ),
    declare(
      "AMT",
      "reit",
      2,
      "REIT de infraestructura, muy apalancado y con contratos largos: prueba que la deuda de un REIT no se lee como la de una industrial.",
    ),
    declare(
      "O",
      "reit",
      2,
      "REIT minorista con dividendo mensual y emisión de acciones constante: el caso donde la dilución tiene que estar a la vista.",
    ),

    // Cíclica — FCFF con margen normalizado.
    declare(
      "CAT",
      "cyclical",
      1,
      "Bienes de capital con ciclo largo y financiera cautiva: el último año como run-rate es exactamente el error que el arquetipo prohíbe.",
    ),
    declare(
      "DE",
      "cyclical",
      2,
      "Ciclo agrícola, desfasado del industrial de CAT: dos cíclicas que no comparten ciclo prueban que el margen normalizado no es una constante.",
    ),
    declare(
      "F",
      "cyclical",
      2,
      "Automotriz con brazo financiero grande y pérdidas en el segmento eléctrico: mezcla ciclo, financiación y un negocio que pierde.",
    ),

    // Commodity — FCFF con precio normalizado.
    declare(
      "XOM",
      "commodity",
      1,
      "Ya ingerida, y además el único caso de sucesión de emisor registrado: su historia se une por linaje de reporte y el gate tiene que verla entera.",
    ),
    declare(
      "FCX",
      "commodity",
      2,
      "Cobre y oro: precio spot muy volátil dentro de la ventana, que es donde perpetuar el spot actual se vuelve visible.",
    ),
    declare(
      "NEM",
      "commodity",
      2,
      "Oro con deterioros recurrentes de reservas: el valor de las reservas es el cross-check del arquetipo.",
    ),
    declare(
      "DVN",
      "commodity",
      2,
      "Shale con dividendo variable atado al precio: la política de distribución cambia con el commodity, no con el resultado contable.",
    ),

    // Holding — SOTP o NAV.
    declare(
      "BRK-B",
      "holding",
      1,
      "El holding del índice. Consolida una aseguradora, un ferrocarril y una cartera de acciones: un DCF consolidado acá es opaco por construcción.",
    ),
    declare(
      "L",
      "holding",
      2,
      "Holding chico y legible, con participaciones cotizantes: permite comprobar un SOTP contra precios observables, cosa que en BRK-B no se puede.",
    ),

    // Distress — APV, escenarios o liquidación.
    declare(
      "CCL",
      "distress",
      1,
      "Sus ejercicios 2020 y 2021 están dentro de la ventana y son distress real —ingresos casi nulos, deuda de emergencia y dilución masiva—, no una etiqueta puesta encima de una empresa sana.",
    ),
    declare(
      "NCLH",
      "distress",
      2,
      "El mismo shock que CCL con una estructura de capital distinta: confirma que lo que se mide es el distress y no una particularidad de un emisor.",
    ),
  ]),
);
