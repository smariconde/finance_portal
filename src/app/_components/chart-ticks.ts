/**
 * Ticks de una escala lineal en pasos redondos (1, 2, 2,5 o 5 por potencia de
 * diez) que cubren el dominio: un eje que marca «3,7 %» o «26,6 %» obliga a
 * hacer la cuenta para leer cualquier punto. El dominio del eje va del primero
 * al último.
 */
export function linearTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return [];
  let low = min;
  let high = max;
  if (low === high) {
    const pad = Math.abs(low) * 0.1 || 1;
    low -= pad;
    high += pad;
  }
  const raw = (high - low) / (target - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((multiple) => multiple * power)
      .find((candidate) => candidate >= raw) ?? 10 * power;
  const start = Math.floor(low / step);
  const end = Math.ceil(high / step);
  const ticks: number[] = [];
  for (let index = start; index <= end; index += 1) {
    // `toPrecision` quita el ruido de coma flotante: 0.1 × 3 no es 0.3.
    ticks.push(Number((index * step).toPrecision(12)));
  }
  return ticks;
}
