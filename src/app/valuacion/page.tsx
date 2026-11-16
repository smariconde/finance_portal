import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";

import { ValuationRequestForm } from "./_components/valuation-request-form";
import {
  ValuedCompanies,
  ValuedCompaniesSkeleton,
} from "./_components/valued-companies";

export const metadata: Metadata = {
  title: "Valuación por ticker | Portal Financiero",
  description:
    "Abre la valuación de una empresa del universo y la evalúa con lo ya guardado.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

/**
 * Entrada de la valuación por ticker (`F6-01`, `F6-12`). El formulario encola
 * con la acción y lleva a la página del ticker, que sigue el pedido y muestra
 * el resultado en el mismo lugar.
 *
 * Debajo, lo ya valuado (decisión del owner del 2026-11-16): la última corrida
 * de cada empresa, leída de la base sin red ni encolado. Va en su propio
 * `Suspense`, así que el formulario se ve aunque la base tarde o no responda.
 */
export default async function ValuationPage() {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice health={health} surface="La corrida por ticker" />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        id="valuation-title"
        title="Valuación por ticker"
        lead={
          <>
            Un símbolo del universo abre su valuación con precio, valor y
            evidencia.
            <InfoTip title="Qué pasa al valuar">
              <p>
                Se abre la página de la empresa, se baja de la SEC lo que falte
                y el cierre del día, se audita la empresa y, si alcanza, el
                valor aparece junto al precio y a lo que el precio exige.
              </p>
              <p>
                Si falta algo cualitativo —la industria cuando el SIC es
                ambiguo, las opciones de empleados o el mix geográfico de
                ingresos—, se lo pide a la IA, que cita el 10-K y pasa por una
                policy; si no alcanza, la página dice qué faltó.
              </p>
            </InfoTip>
          </>
        }
      />
      <ValuationRequestForm />
      <Suspense fallback={<ValuedCompaniesSkeleton />}>
        <ValuedCompanies />
      </Suspense>
      <p className="text-sm text-muted-foreground">
        <Link
          className="text-foreground underline underline-offset-4"
          href="/valuacion/referencia"
        >
          Corrida de referencia
        </Link>{" "}
        · el motor sobre un snapshot fijo
      </p>
    </PageContainer>
  );
}
