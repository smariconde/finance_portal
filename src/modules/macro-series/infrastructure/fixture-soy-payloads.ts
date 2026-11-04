import {
  buildXlsx,
  type CellFixture,
} from "@/modules/reference-data/infrastructure/fixture-xlsx";

/**
 * Synthetic payloads shaped like the soy sources' cables (ADR 0071). The
 * layouts follow what was measured on 2026-11-04; every number is invented.
 */
export function cacPizarraFixture(
  rows: readonly (readonly [serial: string, price: CellFixture])[],
  options: { readonly product?: string; readonly title?: string } = {},
): Uint8Array {
  return buildXlsx([
    {
      name: "Worksheet",
      rows: [
        [null, null, null, options.title ?? "Consulta de precios"],
        [],
        [options.product ?? "Soja"],
        ["Fecha de operación", "Precio"],
        ...rows.map(([serial, price]) => [{ n: serial }, price]),
      ],
    },
  ]);
}

/** BNA's CSV as it comes: `;` separated, a trailing `;`, padded values. */
export function bnaDivisasFixture(
  rows: readonly (readonly [date: string, buyer: string, seller: string])[],
  header = "Moneda;Fecha cotizacion;Compra;Venta;",
): Uint8Array {
  const lines = [
    header,
    ...rows.map(
      ([date, buyer, seller]) => `Dolar U.S.A;${date}; ${buyer}; ${seller};`,
    ),
  ];
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}

function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    if (code > 0xff) throw new Error("not_latin1");
    return code;
  });
}

export type EstimacionesFixtureRow = readonly [
  campaign: string,
  sown: string,
  harvested: string,
  production: string,
  yieldKgHa: string,
];

/** Estimaciones Agrícolas' CSV: latin-1, `;`, the crop quoted on every row. */
export function magypEstimacionesFixture(
  rows: readonly EstimacionesFixtureRow[],
  crop = "Soja total",
): Uint8Array {
  const lines = [
    'Cultivo;Campaña;"Sup. Sembrada";"Sup. Cosechada";Producción;Rendimiento',
    ...rows.map((row) => `"${crop}";${row.join(";")}`),
  ];
  return latin1(`${lines.join("\n")}\n`);
}

/** The CC BY annual CSV published at datos.magyp.gob.ar. */
export function magypAnnualFixture(
  rows: readonly (readonly [
    year: string,
    sown: string,
    harvested: string,
    production: string,
    yieldKgHa: string,
  ])[],
): Uint8Array {
  const lines = [
    "indice_tiempo,superficie_sembrada_soja_ha,superficie_cosechada_soja_ha,produccion_soja_t,rendimiento_soja_kgxha",
    ...rows.map((row) => row.join(",")),
  ];
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}
