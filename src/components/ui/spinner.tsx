import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Indicador de espera de toda la app (`F6-28`). Es decorativo: quien lo usa
 * nombra la espera en texto (el rótulo del botón o una región `status`), así
 * que el ícono no repite el anuncio. Con movimiento reducido queda quieto.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderCircle
      aria-hidden="true"
      data-slot="spinner"
      className={cn("size-4 shrink-0 motion-safe:animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
