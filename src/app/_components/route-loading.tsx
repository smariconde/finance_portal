import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/**
 * Esqueleto de una ruta que lee la base (`F6-28`). Antes no había ningún
 * `loading.tsx` y la navegación se quedaba en la página anterior, sin señal,
 * mientras el servidor leía. Dice qué se está cargando en una región `status`
 * y dibuja la forma de la página, nunca cifras de relleno.
 */
export function RouteLoading({
  label,
  shape,
}: {
  /** Lo que se carga, en una frase corta: «Cargando la valuación». */
  readonly label: string;
  readonly shape: "valuation" | "matrix" | "list";
}) {
  return (
    <div id="contenido" className="flex-1" aria-busy="true">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner />
          {label}…
        </p>
        <div className="flex items-center gap-4">
          {shape === "valuation" ? (
            <Skeleton className="size-14 rounded-full" />
          ) : null}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        {shape === "valuation" ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-28" />
            <Skeleton className="h-64" />
          </>
        ) : shape === "matrix" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Skeleton className="aspect-[4/3] w-full" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
