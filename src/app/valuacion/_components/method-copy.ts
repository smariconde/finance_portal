/**
 * El método de una corrida en palabras; el código queda en la auditoría.
 * Lo leen la lista de lo valuado y la página del ticker.
 */
export const METHOD_COPY: Readonly<Record<string, string>> = {
  fcff_base: "Flujo de caja descontado",
  normalized_fcff: "Flujo de caja con margen de ciclo",
  fcff_three_stage: "Flujo de caja en tres etapas",
  revenue_margin_survival: "Ventas, margen y supervivencia",
  excess_return: "Exceso de retorno sobre patrimonio",
};

export function methodCopy(method: string): string {
  return METHOD_COPY[method] ?? method;
}
