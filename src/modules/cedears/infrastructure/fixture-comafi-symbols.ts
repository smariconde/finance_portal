import { buildXlsx } from "@/modules/reference-data/infrastructure/fixture-xlsx";
import { FIXTURE_CEDEAR_ISINS } from "./fixture-cedear-publications";

/** Invented rows with the measured column layout; no captured workbook. */
export function fixtureComafiSymbols() {
  return buildXlsx([
    {
      name: "LISTA TOTAL DE CEDEARS",
      rows: [
        [
          null,
          "DENOMINACION DEL PROGRAMA CEDEAR",
          "Identificación Mercado",
          "Código Caja de Valores",
          "ISIN CEDEAR",
        ],
        ["1", "Fixture Alpha", "FXAL", "8001", FIXTURE_CEDEAR_ISINS.alpha],
      ],
    },
  ]);
}
