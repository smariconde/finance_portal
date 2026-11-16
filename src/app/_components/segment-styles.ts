/**
 * La gramática de los selectores excluyentes —secciones hermanas, pestañas y
 * botones de rango o vista—: la lista de tabs de shadcn. Un solo lugar para que
 * el diario, el plan, las matrices y los gráficos se vean iguales.
 */
export const segmentGroupClass =
  "inline-flex w-fit max-w-full items-center rounded-lg bg-muted p-[3px] text-muted-foreground";

export const segmentItemClass =
  "inline-flex min-h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

export const segmentActiveClass =
  "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30";
