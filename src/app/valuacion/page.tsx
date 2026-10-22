import type { Metadata } from "next";
import Link from "next/link";

import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";

import { ValuationRequestForm } from "./_components/valuation-request-form";

export const metadata: Metadata = {
  title: "Valuación por ticker | Portal Financiero",
  description:
    "Abre la valuación de una empresa del universo y la evalúa con lo ya guardado.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

/**
 * Entrada de la valuación por ticker (`F6-01`, `F6-12`). El render no lee ni
 * escribe: el formulario encola con la acción y lleva a la página del ticker,
 * que sigue el pedido y muestra el resultado en el mismo lugar.
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
            Valuación por ticker
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Escribí el símbolo de una empresa del universo constituido. Se abre
            su página, se baja de la SEC lo que falte y el cierre del día, se
            audita la empresa y, si alcanza, el valor aparece ahí junto al
            precio y a lo que el precio exige. Si falta algo cualitativo —la
            industria cuando el SIC es ambiguo, las opciones de empleados o el
            mix geográfico de ingresos—, se lo pide a la IA, que cita el 10-K y
            pasa por una policy; si no alcanza, la página dice qué faltó.
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
