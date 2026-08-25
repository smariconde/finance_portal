import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { shortenHash } from "@/modules/valuation/domain/display-format";

/**
 * Par término/valor de una ficha de evidencia. Existe porque en esta superficie
 * casi todo dato viaja con su rótulo: una lista de definición conserva esa
 * relación para un lector de pantalla, cosa que un par de `div` no hace.
 */
export function FieldList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {children}
    </dl>
  );
}

export function Field({
  term,
  children,
  hint,
  className,
}: {
  term: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="mt-1 text-sm font-medium break-words">{children}</dd>
      {hint === undefined ? null : (
        <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>
      )}
    </div>
  );
}

/**
 * Valor técnico literal —hash, identificador, código de motor—. Es
 * monoespaciado porque se compara carácter por carácter, no por decoración.
 */
export function CodeValue({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <code
      className={cn(
        "rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all",
        className,
      )}
    >
      {children}
    </code>
  );
}

/**
 * Hash abreviado para leer, completo para un lector de pantalla y para copiar.
 * El valor íntegro no vive en un `title`: eso lo dejaría accesible sólo con el
 * mouse encima, que es exactamente donde no se puede auditar.
 */
export function HashValue({ hash }: { hash: string }) {
  return (
    <CodeValue className="numeric">
      <span aria-hidden="true">{shortenHash(hash)}</span>
      <span className="sr-only">{hash}</span>
    </CodeValue>
  );
}
