import { randomUUID } from "node:crypto";

import type { Metadata } from "next";

import { InfoTip } from "@/app/_components/info-tip";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import {
  servesRealData,
  servesTradingData,
} from "@/modules/configuration/domain/config-health";
import {
  FINVIZ_FILTER_SOURCE,
  FINVIZ_FILTERS,
  FINVIZ_SCREENER_CATALOG_VERSION,
} from "@/modules/finviz-screener/domain/finviz-screener-catalog";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getFinvizStrategyStore } from "@/server/persistence/trading/get-finviz-strategy-store";
import { safeErrorSummary } from "@/server/trading/safe-error";

import { PlanNav } from "../_components/plan-nav";
import {
  FinvizBuilder,
  type StrategiesState,
} from "./_components/finviz-builder";

export const metadata: Metadata = {
  title: "Finviz · Plan | Portal Financiero",
  description:
    "Armador de links al screener de Finviz y estrategias guardadas.",
  robots: { index: false },
};

export const instant = false;

async function readStrategies(tradingReady: boolean): Promise<StrategiesState> {
  if (!tradingReady) return { state: "disabled" };
  const reference = randomUUID();
  try {
    return {
      state: "ready",
      strategies: await getFinvizStrategyStore().listActive(),
    };
  } catch (error) {
    console.error(
      "finviz strategies failed",
      reference,
      safeErrorSummary(error),
    );
    return { state: "unavailable", reference };
  }
}

/**
 * El screener amplio es Finviz (ADR 0016): el portal arma el link y el
 * navegador lo abre en otra pestaña. Nada de Finviz se baja ni se guarda;
 * las estrategias son la consulta con nombre, en la base de trading.
 */
export default async function FinvizPage() {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health))
    return <RuntimeLockedNotice health={health} surface="El screener" />;
  const strategies = await readStrategies(servesTradingData(health));
  const measured = new Date(
    `${FINVIZ_FILTER_SOURCE.measuredOn}T12:00:00Z`,
  ).toLocaleDateString("es-AR", { timeZone: "UTC" });
  return (
    <div
      id="contenido"
      className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Plan
        </h1>
        <PlanNav current="finviz" />
      </header>
      <FinvizBuilder strategies={strategies} />
      <footer className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>
          Finviz gratis · {FINVIZ_FILTERS.length} variables · catálogo medido el{" "}
          {measured}
        </span>
        <InfoTip title="De dónde sale el catálogo" label="Fuente">
          <p>
            Variables y opciones del screener de Finviz leídas de la página que
            el owner guardó (<code>{FINVIZ_FILTER_SOURCE.filtersVersion}</code>
            ); vistas y señales, declaradas en el código.
          </p>
          <p>
            Lo que Finviz marca Elite no aparece. El portal no descarga nada de
            Finviz: el link se abre en tu navegador.
          </p>
          <p>
            <code>{FINVIZ_SCREENER_CATALOG_VERSION}</code>
          </p>
        </InfoTip>
      </footer>
    </div>
  );
}
