/**
 * La gramática de los selectores compactos sobre la lista de tabs de shadcn:
 * rutas hermanas al lado del título (`SectionNav`: Trades · Estadísticas,
 * Ideas · Finviz, Riesgo · Divergencias) y valores excluyentes (`Segmented`:
 * rango, escala, filtro, unidad). Las partes de una misma página —índice de
 * secciones, grupos de un panel— usan las pestañas subrayadas de
 * `tab-styles.ts`.
 */
export const segmentGroupClass =
  "inline-flex w-fit max-w-full items-center rounded-lg bg-muted p-[3px] text-muted-foreground";

export const segmentItemClass =
  "inline-flex min-h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

export const segmentActiveClass =
  "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30";
