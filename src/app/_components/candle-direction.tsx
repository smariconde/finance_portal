/** La dirección se lee también en texto, sin depender del rojo o del verde. */
export function CandleDirection({
  open,
  close,
}: {
  readonly open: number;
  readonly close: number;
}) {
  const direction =
    close > open ? "Alcista" : close < open ? "Bajista" : "Sin cambio";
  return <span className="font-medium whitespace-nowrap">{direction}</span>;
}
