import type { Metadata } from "next";
import Link from "next/link";

import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";

import { ValuationRequestForm } from "./_components/valuation-request-form";

export const metadata: Metadata = {
  title: "Corrida por ticker | Portal Financiero",
  description:
    "Encola la evaluación de una empresa del universo con lo ya guardado. No publica un valor por acción.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

/**
 * Entrada de la corrida por ticker (`F6-01`). El render no lee ni escribe: el
 * formulario llama a la acción, y el worker evalúa después de responder.
 */
export default async function ValuationPage() {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice health={health} surface="La corrida por ticker" />
    );
  }

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section
          className="flex max-w-prose flex-col gap-3"
          aria-labelledby="valuation-title"
        >
          <h1
            id="valuation-title"
            className="text-2xl font-semibold tracking-tight md:text-3xl"
          >
            Corrida por ticker
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Encola la evaluación de una empresa del universo constituido. Lee lo
            ya guardado y, si alcanza, registra una corrida con supuestos
            derivados. No baja filings ni llama al modelo, y no publica un valor
            por acción.
          </p>
        </section>
        <ValuationRequestForm />
        <p className="max-w-prose text-sm text-muted-foreground">
          <Link
            className="text-foreground underline underline-offset-4"
            href="/valuacion/referencia"
          >
            La corrida de referencia
          </Link>{" "}
          sigue verificando el motor sobre un snapshot fijo.
        </p>
      </div>
    </div>
  );
}
