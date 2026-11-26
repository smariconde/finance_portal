import { CircleDot } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * «Nuevo» lleva el azul de información del sistema —el bermellón es de
 * acción—, y siempre con su palabra: el color nunca va solo (ADR 0079).
 */
export const NEW_TONE =
  "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300";

export type NewsBadgeStatus = "new_period" | "revised" | "arrived";

const TEXT: Readonly<Record<NewsBadgeStatus, string>> = {
  new_period: "Nuevo",
  revised: "Revisado",
  arrived: "Actualizado",
};

/**
 * La marca de una cifra: «Nuevo» (un período que no estaba en la visita
 * anterior), «Revisado» (el mismo período con otra cifra) o «Actualizado»
 * (la cifra cambió mientras la página estaba abierta).
 */
export function NewsBadge({
  status,
  className,
}: {
  readonly status: NewsBadgeStatus;
  readonly className?: string;
}) {
  const accent = status !== "revised";
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-4xl border px-1.5 text-xs leading-none font-medium whitespace-nowrap",
        accent ? NEW_TONE : "border-border bg-background text-muted-foreground",
        className,
      )}
    >
      {accent ? <CircleDot aria-hidden="true" className="size-3" /> : null}
      {TEXT[status]}
    </span>
  );
}
