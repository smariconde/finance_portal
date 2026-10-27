import type { ReactNode } from "react";

/**
 * Un concepto explicado en el lugar donde aparece (`F6-17`). Es un
 * `<details>` nativo: se abre con teclado o click, no necesita JavaScript y
 * un lector de pantalla anuncia su estado.
 */
export function Concept({
  term,
  children,
}: {
  /** Con su artículo: «el WACC», «una recompra». */
  term: string;
  children: ReactNode;
}) {
  return (
    <details className="group min-w-0">
      <summary className="w-fit cursor-pointer text-sm text-primary underline-offset-4 hover:underline">
        ¿Qué es {term}?
      </summary>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
        {children}
      </p>
    </details>
  );
}
