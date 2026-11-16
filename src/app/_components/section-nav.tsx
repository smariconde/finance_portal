import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

import {
  segmentActiveClass,
  segmentGroupClass,
  segmentItemClass,
} from "./segment-styles";

/**
 * Rutas hermanas de una sección —Trades · Estadísticas, Ideas · Finviz,
 * Riesgo · Divergencias—: el vínculo actual lleva `aria-current`, así el estado
 * no depende del color.
 */
export function SectionNav<K extends string>({
  label,
  items,
  current,
}: {
  readonly label: string;
  readonly items: readonly {
    readonly key: K;
    readonly label: string;
    readonly href: string;
  }[];
  readonly current: K;
}) {
  return (
    <nav aria-label={label}>
      <ul className={segmentGroupClass}>
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href as Route}
              aria-current={item.key === current ? "page" : undefined}
              className={cn(
                segmentItemClass,
                item.key === current && segmentActiveClass,
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
