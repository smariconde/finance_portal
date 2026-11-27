import { DatabaseZap } from "lucide-react";

/** La base no respondió: se dice, sin el error (`TM-02`). */
export function ListingsUnavailable() {
  return (
    <p
      role="status"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <DatabaseZap aria-hidden="true" className="size-4 shrink-0" />
      Avisos no disponibles: la base personal no respondió.
    </p>
  );
}
