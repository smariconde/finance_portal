"use client";

import { ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { breadcrumbsFor } from "@/app/_components/navigation";
import { cn } from "@/lib/utils";

/**
 * Dónde está el owner, en el header: «Trading › Plan». La marca ya está en la
 * sidebar; repetirla acá no decía nada y en un teléfono se cortaba. En ese
 * ancho quedan los dos últimos pasos, que son los que orientan.
 */
export function PageLocation() {
  const crumbs = breadcrumbsFor(usePathname());

  if (crumbs.length === 0) {
    return <p className="truncate text-sm font-medium">Portal Financiero</p>;
  }

  return (
    <nav aria-label="Ubicación" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const hiddenOnPhone = index < crumbs.length - 2;
          const firstOnPhone = index === crumbs.length - 2;
          return (
            <li
              key={`${index}-${crumb.label}`}
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                hiddenOnPhone && "max-sm:hidden",
                // Sin lugar, se corta primero lo de arriba: la página actual es
                // lo que orienta.
                !isLast && "shrink-[4]",
              )}
            >
              {index === 0 ? null : (
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground",
                    firstOnPhone && "max-sm:hidden",
                  )}
                />
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  className="min-w-0 truncate font-medium"
                >
                  {crumb.label}
                </span>
              ) : crumb.href === null ? (
                <span className="min-w-0 truncate text-muted-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href as Route}
                  className="min-w-0 truncate rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
