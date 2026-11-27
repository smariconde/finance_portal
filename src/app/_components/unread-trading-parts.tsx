import { TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TradingPart } from "@/server/trading/trading-parts";

import { InfoTip } from "./info-tip";

const PART_VIEW: Readonly<
  Record<TradingPart, { readonly label: string; readonly without: string }>
> = {
  risk_settings: {
    label: "reglas",
    without: "Rigen las reglas por defecto y no se pueden editar.",
  },
  pre_market: {
    label: "planes del pre-market",
    without: "Ningún trade toma el stop ni el target de su idea.",
  },
  annotations: {
    label: "anotaciones",
    without: "Sin setup, plan ni R de lo anotado en cada trade.",
  },
};

/**
 * Lo que la base de trading todavía no tiene (`F11-15`): una migración sin
 * aplicar deja la tarjeta leída con lo que rige sin esa parte, y esta línea la
 * nombra. Una falla de conexión o permisos no llega acá: sigue con referencia.
 */
export function UnreadTradingParts({
  parts,
  className,
}: {
  readonly parts: readonly TradingPart[];
  readonly className?: string;
}) {
  if (parts.length === 0) return null;
  // Un `div`: el panel del ⓘ trae sus propios párrafos.
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-xs text-warning",
        className,
      )}
    >
      <TriangleAlert className="size-3.5" aria-hidden="true" />
      Sin leer: {parts.map((part) => PART_VIEW[part].label).join(" · ")}
      <InfoTip title="Partes sin leer">
        <p>
          La base de trading no tiene la tabla: falta aplicar su migración (
          <code className="font-mono text-xs">pnpm db:trading:migrate</code>).
        </p>
        <ul className="list-disc pl-4">
          {parts.map((part) => (
            <li key={part}>{PART_VIEW[part].without}</li>
          ))}
        </ul>
      </InfoTip>
    </div>
  );
}
