import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * El diario y sus estadísticas son rutas hermanas (`F11-08`), como las dos
 * matrices de un sector: el vínculo actual es texto con `aria-current`.
 */
export function JournalNav({
  current,
}: {
  readonly current: "journal" | "stats";
}) {
  const items = [
    { key: "journal", label: "Trades", href: "/diario" },
    { key: "stats", label: "Estadísticas", href: "/diario/estadisticas" },
  ] as const;

  return (
    <nav aria-label="Secciones del diario">
      <ul className="inline-flex w-fit rounded-lg border bg-muted/40 p-0.5">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.key === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                item.key === current && "bg-card text-foreground shadow-xs",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
