import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Un `<select>` nativo con la forma de `Input`: mismo alto, radio, borde y foco.
 * Nativo a propósito: en el teléfono abre el selector del sistema y conserva
 * `optgroup`, búsqueda por tecla y accesibilidad sin código propio.
 */
function NativeSelect({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<"select"> & { readonly wrapperClassName?: string }) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn("relative w-full min-w-0", wrapperClassName)}
    >
      <select
        data-slot="native-select"
        className={cn(
          "h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 [&_optgroup]:bg-popover [&_option]:bg-popover [&_option]:text-popover-foreground",
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
