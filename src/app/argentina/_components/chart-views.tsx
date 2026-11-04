"use client";

import { useState, type ReactNode } from "react";

import { Segmented } from "./chart-kit";

/**
 * Las formas de mirar un mismo dato (`F9-13`): la línea de tiempo y, donde
 * aplica, otra lectura —por gobierno, o la inflación interanual en vez de la
 * mensual—. Cada vista trae su propia tabla equivalente.
 */
export function ChartViews({
  label,
  views,
}: {
  readonly label: string;
  readonly views: readonly {
    readonly id: string;
    readonly label: string;
    readonly content: ReactNode;
  }[];
}) {
  const [viewId, setViewId] = useState(views[0]?.id ?? "");
  const view = views.find((item) => item.id === viewId) ?? views[0];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {views.length > 1 ? (
        <div className="self-start">
          <Segmented
            label={label}
            options={views.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            value={view?.id ?? ""}
            onChange={setViewId}
          />
        </div>
      ) : null}
      {view?.content}
    </div>
  );
}
