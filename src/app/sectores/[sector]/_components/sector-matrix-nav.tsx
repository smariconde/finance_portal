import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Las dos matrices de un sector son rutas hermanas: cada una lee sólo lo suyo.
 * El vínculo actual es texto con `aria-current`, no un control muerto.
 */
export function SectorMatrixNav({
  sectorCode,
  current,
}: {
  readonly sectorCode: string;
  readonly current: "risk" | "divergences";
}) {
  const items = [
    { key: "risk", label: "Riesgo", href: `/sectores/${sectorCode}` },
    {
      key: "divergences",
      label: "Divergencias",
      href: `/sectores/${sectorCode}/divergencias`,
    },
  ] as const;

  return (
    <nav aria-label="Matrices del sector">
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
