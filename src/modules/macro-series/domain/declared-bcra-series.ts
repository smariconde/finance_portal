import type { BcraVariableId } from "./bcra-monetary-source";

/**
 * Variables cuyas observaciones se descargan (`F9-01`, ADR 0065, decisión 2).
 *
 * Son las 35 de la categoría «Principales Variables» tal como el catálogo la
 * mostró el 2026-11-02. La lista está en código y no se deriva del catálogo en
 * cada corrida: el BCRA puede mover una variable de categoría, y lo que el
 * portal descarga tiene que cambiar por un diff revisable, no por su cuenta.
 *
 * `label` es la descripción de ese día, sólo para leer la lista: la definición
 * vigente es la del catálogo registrado.
 */
export type DeclaredBcraSeries = {
  readonly variableId: BcraVariableId;
  readonly label: string;
};

export const DECLARED_BCRA_SERIES_VERSION = "declared-bcra-series-1.0.0";

export const DECLARED_BCRA_SERIES: readonly DeclaredBcraSeries[] =
  Object.freeze([
    { variableId: 1, label: "Reservas internacionales" },
    { variableId: 4, label: "Tipo de cambio minorista (promedio vendedor)" },
    { variableId: 5, label: "Tipo de cambio mayorista de referencia" },
    { variableId: 7, label: "Tasa de interés BADLAR de bancos privados" },
    { variableId: 8, label: "Tasa de interés TM20 de bancos privados" },
    {
      variableId: 11,
      label:
        "Tasa de interés de préstamos entre entidades financiera privadas (BAIBAR)",
    },
    {
      variableId: 12,
      label:
        "Tasa de interés de depósitos a 30 días de plazo en entidades financieras",
    },
    {
      variableId: 13,
      label: "Tasa de interés por adelantos en cuenta corriente",
    },
    { variableId: 14, label: "Tasa de interés de préstamos personales" },
    { variableId: 15, label: "Base monetaria" },
    { variableId: 16, label: "Circulación monetaria" },
    { variableId: 17, label: "Billetes y monedas en poder del público" },
    { variableId: 18, label: "Efectivo en entidades financieras." },
    {
      variableId: 19,
      label:
        "Depósitos de las entidades financieras en cuenta corriente en el BCRA",
    },
    {
      variableId: 21,
      label: "Depósitos en efectivo en las entidades financieras",
    },
    {
      variableId: 22,
      label:
        "Depósitos en efectivo en las entidades financieras en cuentas corrientes(neto de utilización FUCO)",
    },
    {
      variableId: 23,
      label:
        "Depósitos en efectivo en las entidades financieras en cajas de ahorro",
    },
    {
      variableId: 24,
      label:
        "Depósitos a plazo en efectivo en las entidades financieras (incluye inversiones y excluye CEDROs)",
    },
    {
      variableId: 25,
      label:
        "Variación interanual del promedio móvil de 30 días del M2 privado.",
    },
    {
      variableId: 26,
      label: "Préstamos de las entidades financieras al sector privado",
    },
    { variableId: 27, label: "Inflación mensual." },
    { variableId: 28, label: "Inflación interanual." },
    {
      variableId: 29,
      label:
        "Mediana de la variación interanual próximos 12 meses del índice de precios al consumidor del relevamiento de expectativas de mercado",
    },
    {
      variableId: 30,
      label: "Coeficiente de estabilización de referencia (base 2.2.02=1)",
    },
    {
      variableId: 31,
      label: "Unidad de valor adquisitivo (base 31.3.16=14.05)",
    },
    { variableId: 32, label: "Unidad de vivienda (base 31.3.16=14.05)" },
    { variableId: 35, label: "Tasa de interés BADLAR de bancos privados" },
    {
      variableId: 40,
      label: "Índice para Contratos de Locación (base 30.6.20=1)",
    },
    {
      variableId: 43,
      label: "Tasa de interés Comunicado P 14.290 (Uso de justicia)",
    },
    { variableId: 44, label: "Tasa de interes TAMAR de bancos privados" },
    { variableId: 45, label: "Tasa de interés TAMAR de bancos privados" },
    {
      variableId: 1187,
      label: "Régimen de bandas cambiarias. Límite inferior",
    },
    {
      variableId: 1188,
      label: "Régimen de bandas cambiarias. Límite superior",
    },
    {
      variableId: 1197,
      label: "Tasa de Intereses Moratorios (TIM) CCC, art. 768(c)",
    },
    { variableId: 1198, label: "Tasa pasiva Ley 27.802, art. 55(a)" },
  ]);

export function findDeclaredBcraSeries(
  variableId: BcraVariableId,
): DeclaredBcraSeries | null {
  return (
    DECLARED_BCRA_SERIES.find((series) => series.variableId === variableId) ??
    null
  );
}
