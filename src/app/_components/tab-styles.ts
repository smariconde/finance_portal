/**
 * La gramática de las pestañas: rótulos sobre una línea de base y la elegida
 * subrayada en `primary` (2 px), como el índice del resultado de valuación.
 * Recorren las partes de una misma página —el índice de secciones de una
 * página larga, los grupos de un panel—. Las rutas hermanas (`SectionNav`) y
 * los valores excluyentes (`Segmented`) usan `segment-styles.ts`.
 *
 * La línea de base es una sombra interior del contenedor y no un borde: así el
 * subrayado de la pestaña elegida la tapa sin márgenes negativos, que en una
 * lista con desplazamiento lateral se recortaban. La lista es `relative`: sin
 * eso, un texto `sr-only` (absoluto) de una pestaña fuera de la vista escapa
 * del recorte y ensancha la página en un teléfono.
 */
export const tabBaselineClass = "shadow-[inset_0_-1px_0_var(--color-border)]";

export const tabListClass =
  "relative flex [scrollbar-width:none] gap-x-1 overflow-x-auto text-sm whitespace-nowrap [&::-webkit-scrollbar]:hidden";

export const tabItemClass =
  "inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2 outline-none transition-[color,border-color] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none md:h-10";

export const tabActiveClass = "border-primary font-medium text-foreground";

export const tabInactiveClass =
  "border-transparent text-muted-foreground hover:border-foreground/20 hover:text-foreground";

/** Las clases de una pestaña según esté elegida. */
export function tabClass(active: boolean): string {
  return `${tabItemClass} ${active ? tabActiveClass : tabInactiveClass}`;
}
