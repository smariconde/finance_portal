import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * El plan y el armador de Finviz son rutas hermanas (`F11-13`), como el diario
 * y sus estadísticas: el vínculo actual lleva `aria-current`.
 */
export function PlanNav({ current }: { readonly current: "ideas" | "finviz" }) {
  const items = [
    { key: "ideas", label: "Ideas", href: "/plan" },
    { key: "finviz", label: "Finviz", href: "/plan/finviz" },
  ] as const;

  return (
    <nav aria-label="Secciones del plan">
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
