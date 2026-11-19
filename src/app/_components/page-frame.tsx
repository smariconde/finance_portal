import type { ReactNode } from "react";

/**
 * El contenedor de una página: el mismo ancho y los mismos márgenes en todas
 * —las de trading y la carga de ruta usan las mismas clases—, así el título no
 * salta de lugar al cambiar de página.
 */
export function PageContainer({ children }: { readonly children: ReactNode }) {
  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        {children}
      </div>
    </div>
  );
}

function PageTitle({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}) {
  return (
    <h1
      id={id}
      className="max-w-4xl text-2xl font-semibold tracking-tight text-balance md:text-3xl"
    >
      {children}
    </h1>
  );
}

/**
 * El encabezado de una página: el título, a lo sumo una línea que lo precisa
 * —el resto va en un `InfoTip`— y las acciones a la derecha. Al lado del
 * título, el selector de rutas hermanas (`SectionNav`) cuando la sección lo
 * tiene: en la misma línea no ocupa una fila propia. El header del shell ya
 * dice dónde está el owner, así que no hay un vínculo «volver» acá.
 */
export function PageHeader({
  id,
  title,
  lead,
  leading,
  actions,
  nav,
  children,
}: {
  readonly id: string;
  readonly title: ReactNode;
  /** Una línea, sin punto final obligatorio; puede cerrar con un `InfoTip`. */
  readonly lead?: ReactNode;
  /** Antes del título: el logo de la empresa. */
  readonly leading?: ReactNode;
  /** A la derecha: el botón o el estado de la página. */
  readonly actions?: ReactNode;
  /** Debajo: datos de la página en una línea (fecha, método). */
  readonly children?: ReactNode;
  /** Al lado del título: el selector de rutas hermanas (`SectionNav`). */
  readonly nav?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="flex min-w-0 flex-col gap-1">
            {nav === undefined ? (
              <PageTitle id={id}>{title}</PageTitle>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <PageTitle id={id}>{title}</PageTitle>
                {nav}
              </div>
            )}
            {lead === undefined ? null : (
              <div className="max-w-3xl text-sm text-muted-foreground md:text-base">
                {lead}
              </div>
            )}
          </div>
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
