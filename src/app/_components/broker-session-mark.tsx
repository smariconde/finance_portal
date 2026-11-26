"use client";

import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import {
  checkMarketHours,
  type MarketHoursResult,
} from "@/app/calendario/actions";
import type { SessionCorroboration } from "@/modules/market-calendar/domain/session-corroboration";

import { InfoTip } from "./info-tip";
import { shortMarketDate } from "./market-format";

type View = { readonly state: "loading" } | MarketHoursResult;

const FAILURE_COPY: Readonly<Record<string, string>> = {
  market_hours_schema_changed: "formato no reconocido",
  market_hours_product_missing: "formato no reconocido",
  market_hours_product_ambiguous: "formato no reconocido",
  market_hours_date_mismatch: "respondió otra fecha",
  market_hours_interval_invalid: "formato no reconocido",
  invalid_json: "formato no reconocido",
};

function brokerSays(day: SessionCorroboration): string {
  const regular = day.broker.regular;
  return regular === null ? "cerrada" : `${regular.open}–${regular.close}`;
}

/**
 * Lo que dice Schwab del horario de hoy y de la próxima sesión, al lado de lo
 * declarado (`F12-01`). Pide una vez al dibujarse; sin Schwab configurado no
 * muestra nada. Si no coincide, para ese día vale Schwab.
 */
export function BrokerSessionMark() {
  const [view, setView] = useState<View>({ state: "loading" });

  useEffect(() => {
    let active = true;
    checkMarketHours().then(
      (result) => {
        if (active) setView(result);
      },
      () => {
        if (active)
          setView({ state: "failed", code: "unreachable", path: null });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (view.state === "unavailable") return null;

  if (view.state === "loading") {
    return (
      <span className="text-muted-foreground" aria-live="polite">
        Schwab…
      </span>
    );
  }

  if (view.state === "failed") {
    return (
      <span
        className="flex items-center gap-1 text-muted-foreground"
        aria-live="polite"
      >
        <CircleSlash className="size-3.5" aria-hidden="true" />
        Schwab no corroboró · {FAILURE_COPY[view.code] ?? "no respondió"}
        <InfoTip title="Por qué">
          <p className="font-mono text-xs">
            {view.code}
            {view.path === null ? "" : ` · ${view.path}`}
          </p>
        </InfoTip>
      </span>
    );
  }

  const today = view.days[0];
  const differing = view.days.filter((day) => !day.matches);

  if (differing.length === 0) {
    const extended = today?.broker.extended ?? null;
    return (
      <span className="flex items-center gap-1" aria-live="polite">
        <CircleCheck
          className="size-3.5 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <span>Schwab coincide</span>
        {extended === null ? null : (
          <span className="text-muted-foreground">
            · extendido{" "}
            <span className="numeric text-foreground">
              {extended.open}–{extended.close}
            </span>
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1" aria-live="polite">
      <TriangleAlert
        className="size-3.5 text-amber-700 dark:text-amber-400"
        aria-hidden="true"
      />
      <span>Schwab dice otra cosa:</span>
      {differing.map((day) => (
        <span key={day.date} className="numeric">
          {day.date === today?.date ? "hoy" : shortMarketDate(day.date)}{" "}
          {brokerSays(day)}
        </span>
      ))}
      <InfoTip title="Qué vale">
        <p>
          Para ese día vale lo que dice Schwab: es donde se opera. La tabla
          declarada de la NYSE no cambia sola.
        </p>
      </InfoTip>
    </span>
  );
}
