/**
 * What each block of `/argentina` is for and how to read it
 * (`argentina-block-guides-1.0.0`, `F9-23`, owner's request of 2026-11-26:
 * «un tooltip para qué sirve cada análisis, qué podemos inferir»).
 *
 * The guide lives behind an ⓘ next to the block's title, never in the body
 * (the owner wants no paragraphs on the page). It is short lines, in four
 * parts: the question the block answers, how to read what is drawn, which
 * other blocks to read it with, and the traps. The voice is the surface's:
 * it describes and teaches to read, never explains a cause, forecasts or
 * says to buy or sell. A reference range is one this project measured, and
 * says where.
 */
export const ARGENTINA_BLOCK_GUIDES_VERSION = "argentina-block-guides-1.0.0";

/** The blocks of the page, by anchor, in page order, with their short name. */
export const ARGENTINA_BLOCKS = [
  { id: "actividad", label: "Actividad" },
  { id: "dolar", label: "Dólar" },
  { id: "itcrm", label: "ITCRM" },
  { id: "riesgo-pais", label: "Riesgo país" },
  { id: "monetario", label: "Inflación y reservas" },
  { id: "rem-inflacion", label: "REM" },
  { id: "fiscal", label: "Fiscal" },
  { id: "externo", label: "Comercio" },
  { id: "soja", label: "Soja" },
] as const;

export type ArgentinaBlockId = (typeof ARGENTINA_BLOCKS)[number]["id"];

export const ARGENTINA_BLOCK_IDS: readonly ArgentinaBlockId[] =
  ARGENTINA_BLOCKS.map((block) => block.id);

/** The short name of a block, as the index names it. */
export function argentinaBlockLabel(blockId: ArgentinaBlockId): string {
  return ARGENTINA_BLOCKS.find((block) => block.id === blockId)!.label;
}

export function isArgentinaBlockId(value: string): value is ArgentinaBlockId {
  return ARGENTINA_BLOCK_IDS.includes(value as ArgentinaBlockId);
}

export type BlockGuide = {
  /** The question the block answers, in one line. */
  readonly purpose: string;
  /** How to read what is drawn: one idea per line. */
  readonly read: readonly string[];
  /** Other blocks to read it with, and what the pair says. */
  readonly crossWith: readonly {
    readonly blockId: ArgentinaBlockId;
    readonly text: string;
  }[];
  /** What can mislead: lags, revisions, coverage, breaks. */
  readonly caveats: readonly string[];
};

export const ARGENTINA_BLOCK_GUIDES: Readonly<
  Record<ArgentinaBlockId, BlockGuide>
> = {
  actividad: {
    purpose:
      "Si la economía produce más o menos que antes: el EMAE es el anticipo mensual del PIB.",
    read: [
      "Var. mensual: el pulso corto, sin estacionalidad. Un mes solo es ruido; mirá varios seguidos.",
      "Interanual: contra el mismo mes del año anterior. Gira más lento, pero no depende del ajuste estacional.",
      "Tendencia-ciclo: la dirección sin el ruido de cada mes.",
      "Mapa de sectores: qué rubros explican el total. Una suba de pocos sectores no dice lo mismo que una pareja.",
    ],
    crossWith: [
      {
        blockId: "externo",
        text: "las importaciones suelen moverse con la actividad.",
      },
      {
        blockId: "monetario",
        text: "inflación y pesos reales, para ver el contexto del ciclo.",
      },
      {
        blockId: "fiscal",
        text: "la recaudación sigue a la actividad.",
      },
    ],
    caveats: [
      "Sale unas siete semanas después del mes.",
      "El INDEC revisa los últimos meses en cada publicación: la var. mensual se corrige más que la interanual.",
    ],
  },
  dolar: {
    purpose:
      "Cuánto vale el dólar oficial, cuánto el de mercado y cuánto se separan.",
    read: [
      "Mayorista: el oficial de referencia del BCRA. La posición en la banda dice cuánto margen queda hasta el piso y el techo.",
      "CCL implícito: el dólar que surge de comprar una acción acá y venderla afuera; el de quien entra o saca capital.",
      "Brecha: CCL / oficial − 1. Medida acá: 0–2 % sin controles, 35–55 % en 2012–15 y 69–103 % en 2020–23 (medianas anuales).",
    ],
    crossWith: [
      {
        blockId: "monetario",
        text: "las reservas son el respaldo del BCRA para sostener el oficial.",
      },
      {
        blockId: "itcrm",
        text: "si ese dólar es alto o bajo en términos reales, frente a su historia.",
      },
      {
        blockId: "riesgo-pais",
        text: "brecha y riesgo país miden la desconfianza desde dos lados: el cambiario y el de la deuda.",
      },
    ],
    caveats: [
      "El CCL es una tasa calculada con diez pares ADR, no una cotización publicada: con menos de tres pares no hay dato.",
      "Con cepo el oficial lee mal el dólar: por eso el CCL va al lado, nunca en su lugar.",
    ],
  },
  itcrm: {
    purpose:
      "Si el peso está apreciado o depreciado frente a los socios comerciales, descontada la inflación de cada uno.",
    read: [
      "Sube: el resto del mundo se encarece medido en pesos. Baja: la Argentina se encarece medida en dólares.",
      "Compará contra momentos de la propia serie, no contra 100: la base es una fecha (17/12/2015), no un equilibrio.",
      "Un dólar nominal que sube menos que la inflación hace bajar el índice.",
    ],
    crossWith: [
      {
        blockId: "dolar",
        text: "el dólar nominal; el ITCRM es su lectura real.",
      },
      {
        blockId: "externo",
        text: "un peso apreciado abarata importar y encarece exportar.",
      },
      {
        blockId: "monetario",
        text: "la inflación local es la mitad del cálculo.",
      },
    ],
    caveats: [
      "Carga manual: se actualiza con un comando, mirá la fecha del último dato.",
      "El BCRA estima los precios del último tramo y revisa días recientes cuando llegan los datos.",
    ],
  },
  "riesgo-pais": {
    purpose:
      "Cuánto más que los Estados Unidos paga la Argentina para endeudarse en dólares.",
    read: [
      "En puntos básicos: 100 pb es un punto de tasa; 1.000 pb son diez puntos por encima del Tesoro.",
      "Es un piso para la tasa en dólares de cualquier deudor argentino y pesa en la tasa con que se descuenta un activo local.",
      "Importan el nivel y la tendencia: una baja sostenida es más informativa que un día.",
    ],
    crossWith: [
      {
        blockId: "fiscal",
        text: "el resultado fiscal es lo que mira quien presta.",
      },
      {
        blockId: "monetario",
        text: "las reservas son con qué se pagan los vencimientos en dólares.",
      },
      {
        blockId: "dolar",
        text: "la brecha, la otra cara de la desconfianza.",
      },
    ],
    caveats: [
      "El 30/09/2025 cambió el índice (EMBI+ → EMBI Global Diversified): comparar a través de esa fecha mezcla canastas.",
      "Es el cierre del día anterior; el valor durante la rueda puede ser otro.",
    ],
  },
  monetario: {
    purpose:
      "A qué ritmo suben los precios, cuántos dólares tiene el BCRA y cuántos pesos hay en términos reales.",
    read: [
      "Inflación mensual: la velocidad. La interanual arrastra doce meses y tarda en mostrar un cambio de ritmo.",
      "Reservas brutas: su tendencia dice más que el nivel.",
      "Base monetaria real: los pesos emitidos, descontada la inflación. Si cae, hay menos pesos en términos reales.",
    ],
    crossWith: [
      {
        blockId: "rem-inflacion",
        text: "si la inflación salió por encima o por debajo de lo esperado.",
      },
      {
        blockId: "dolar",
        text: "reservas y brecha, el frente cambiario completo.",
      },
      {
        blockId: "actividad",
        text: "pesos reales y nivel de actividad.",
      },
    ],
    caveats: [
      "El IPC sale unas dos semanas después del mes.",
      "Las reservas son brutas: incluyen swaps, encajes y préstamos que no son de libre uso. El portal no calcula las netas.",
    ],
  },
  "rem-inflacion": {
    purpose:
      "Qué inflación esperaban los analistas para cada mes y cuánto se equivocaron.",
    read: [
      "Error = observado − esperado, en puntos: positivo es una inflación mayor a la esperada.",
      "Para un instrumento en pesos cuenta la sorpresa —la diferencia con lo esperado—, no sólo el nivel.",
      "Los meses que vienen son expectativas, no inflación observada.",
    ],
    crossWith: [
      {
        blockId: "monetario",
        text: "el IPC observado de cada mes.",
      },
      {
        blockId: "dolar",
        text: "el dólar, que pesa en los precios.",
      },
    ],
    caveats: [
      "Carga manual: cada ronda se verifica y se carga con un comando.",
      "Es la mediana de los participantes del relevamiento, no un pronóstico del BCRA.",
    ],
  },
  fiscal: {
    purpose:
      "Si el Estado nacional gasta más o menos de lo que recauda, antes y después de pagar los intereses de su deuda.",
    read: [
      "Primario: ingresos menos gastos sin intereses. Positivo es superávit.",
      "Intereses netos: lo que cuesta la deuda. Primario menos intereses es el resultado financiero.",
      "Sobre el PIB para comparar años; el año en curso va en pesos porque su PIB no está completo.",
    ],
    crossWith: [
      {
        blockId: "riesgo-pais",
        text: "lo que mira quien presta.",
      },
      {
        blockId: "monetario",
        text: "un déficit financiado con emisión aparece en la base monetaria.",
      },
      {
        blockId: "actividad",
        text: "la recaudación sigue a la actividad.",
      },
    ],
    caveats: [
      "Sector público nacional no financiero, base caja: no incluye provincias ni el BCRA.",
      "Los meses tienen estacionalidad (aguinaldo, Ganancias): no compares un mes con el anterior.",
    ],
  },
  externo: {
    purpose:
      "Cuántos dólares entran por vender bienes y cuántos salen por comprarlos.",
    read: [
      "Saldo positivo: entran más dólares de los que salen por bienes; es una de las fuentes de dólares del país.",
      "La suma de doce meses saca la estacionalidad de la cosecha.",
      "Exportaciones: pesan el agro y la energía. Importaciones: siguen a la actividad.",
    ],
    crossWith: [
      {
        blockId: "soja",
        text: "precio y cosecha del principal producto exportado.",
      },
      {
        blockId: "itcrm",
        text: "un peso apreciado abarata importar.",
      },
      {
        blockId: "monetario",
        text: "el saldo es una de las fuentes de reservas.",
      },
    ],
    caveats: [
      "Sólo bienes: no incluye servicios (turismo), intereses ni movimientos de capital.",
      "Exportaciones FOB, importaciones CIF: las importaciones incluyen flete y seguro.",
    ],
  },
  soja: {
    purpose:
      "Cuánto del precio internacional de la soja le llega al productor en Rosario.",
    read: [
      "Brecha = Rosario en US$ / Chicago − 1. Más negativa: llega menos del precio de Chicago.",
      "Junta retenciones, flete, márgenes y calidad: un cambio de retenciones la mueve de golpe (marcado en el gráfico).",
      "Al dólar del exportador (2022–2025): la tasa a la que se liquidaba de verdad, la que se compara para vender o guardar.",
    ],
    crossWith: [
      {
        blockId: "externo",
        text: "lo que la cosecha aporta a las exportaciones.",
      },
      {
        blockId: "dolar",
        text: "la brecha cambiaria y el dólar con que se liquida.",
      },
      {
        blockId: "actividad",
        text: "el agro en el mapa de sectores.",
      },
    ],
    caveats: [
      "Chicago es el cierre de Yahoo del contrato más cercano; los días en período de entrega se marcan.",
      "En la cosecha (abril–junio, marcada en el gráfico) entra más oferta local.",
    ],
  },
};
