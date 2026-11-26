import {
  Calculator,
  ChartScatter,
  ChevronRight,
  GraduationCap,
  Landmark,
  ListChecks,
  NotebookPen,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MarketStrip } from "@/app/_components/market-strip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { StatusMark } from "@/app/_components/status-mark";
import { ValuationRequestForm } from "@/app/valuacion/_components/valuation-request-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  servesRealData,
  servesSchwabConnection,
} from "@/modules/configuration/domain/config-health";
import {
  forwardedCallbackPath,
  schwabCallbackForm,
} from "@/modules/trading/domain/schwab-callback-url";
import { getRequestConfigHealth } from "@/server/config/app-environment";

/**
 * Cada página de trabajo con la pregunta que responde, en una línea. El inicio
 * no lee nada para dibujarlas: ni la base ni Schwab se abren al entrar.
 */
const analysisLinks = [
  {
    href: "/sectores",
    label: "Matrices",
    icon: ChartScatter,
    detail: "Sortino y divergencias por sector, con los CEDEAR marcados",
  },
  {
    href: "/argentina",
    label: "Argentina",
    icon: Landmark,
    detail: "Actividad, dólar, inflación, reservas, resultado fiscal y soja",
  },
] as const;

const tradingLinks = [
  {
    href: "/cuenta",
    label: "Cuenta",
    icon: Wallet,
    detail: "Saldos, posiciones y riesgo, en vivo desde Schwab",
  },
  {
    href: "/plan",
    label: "Plan",
    icon: ListChecks,
    detail: "Ideas con stop, target y tamaño antes de la rueda",
  },
  {
    href: "/diario",
    label: "Diario",
    icon: NotebookPen,
    detail: "Trades, calendario de P&L y estadísticas en R",
  },
  {
    href: "/lecciones",
    label: "Lecciones",
    icon: GraduationCap,
    detail: "Conceptos y setups de análisis técnico",
  },
] as const;

const evidenceContract = [
  ["Fuente", "Origen verificable y sus derechos"],
  ["Corte", "Lo que se sabía a esa fecha, sin look-ahead"],
  ["Unidad", "Moneda y escala junto a cada cifra"],
  ["Transformación", "Fórmula versionada y reproducible"],
] as const;

/**
 * La resolución del modo efectivo ocurre en el request
 * ([ADR 0005](../../docs/architecture/adr/0005-request-time-runtime-boundary.md)),
 * así que la ruta se sirve entera cuando llega. El render no abre la base: la
 * valuación se pide con la misma acción de `/valuacion`.
 */
export const instant = false;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const health = await getRequestConfigHealth();

  // Vuelta de Schwab al callback del Flask, que la app tiene registrado en la
  // raíz de 127.0.0.1 (`F11-03`): se reenvía al callback del portal con sólo
  // `code`, `state` y `error`. Fuera de ese caso la raíz ignora el query.
  if (
    servesSchwabConnection(health) &&
    schwabCallbackForm(process.env.SCHWAB_CALLBACK_URL, {
      onVercel: process.env.VERCEL === "1",
    }) === "local_root"
  ) {
    const forward = forwardedCallbackPath(await searchParams);
    if (forward !== null) redirect(forward as Route);
  }

  const live = servesRealData(health);
  const attentionCount = health.items.filter(
    (item) => item.status === "degraded",
  ).length;

  return (
    <PageContainer>
      <PageHeader id="inicio-title" title="Inicio" />
      <MarketStrip />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="analysis-title">
          <Card>
            <CardHeader className="border-b">
              <CardTitle as="h2" id="analysis-title">
                Análisis
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Calculator
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                Valuar una empresa
              </h3>
              {live ? (
                <ValuationRequestForm />
              ) : (
                <StatusMark status="disabled" label="Runtime trabado" />
              )}
            </CardContent>
            <CardContent className="border-t px-0">
              <LinkList links={analysisLinks} />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="trading-title">
          <Card className="gap-0">
            <CardHeader className="border-b">
              <CardTitle as="h2" id="trading-title">
                Trading
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <LinkList links={tradingLinks} />
            </CardContent>
          </Card>
        </section>
      </div>

      <div className="grid items-start gap-6 border-t pt-6 lg:grid-cols-2">
        <section aria-labelledby="verification-title">
          <Card className="gap-0">
            <CardHeader className="border-b">
              <CardTitle as="h2" id="verification-title">
                Verificación
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <ul className="divide-y">
                <li>
                  <Link href="/valuacion/referencia" className={rowClass}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        Corrida de referencia del motor
                      </span>
                      <span className="text-sm text-muted-foreground">
                        Un snapshot fijo, siempre el mismo hash
                      </span>
                    </span>
                    <RowChevron />
                  </Link>
                </li>
                <li>
                  <Link href="/configuracion" className={rowClass}>
                    <span className="flex flex-col items-start gap-1.5">
                      <span className="text-sm font-medium">
                        Diagnóstico de configuración
                      </span>
                      <StatusMark
                        status={
                          !live
                            ? "disabled"
                            : attentionCount > 0
                              ? "degraded"
                              : "ready"
                        }
                        label={
                          !live
                            ? "Runtime trabado"
                            : attentionCount > 0
                              ? `${attentionCount} pendiente${attentionCount === 1 ? "" : "s"}`
                              : "Sin pendientes"
                        }
                      />
                    </span>
                    <RowChevron />
                  </Link>
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section
          className="flex flex-col gap-4"
          aria-labelledby="evidence-title"
        >
          <h2
            id="evidence-title"
            className="flex items-center gap-2 text-base font-medium"
          >
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Contrato de evidencia
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            {evidenceContract.map(([term, description]) => (
              <div className="flex flex-col gap-1" key={term}>
                <dt className="text-sm font-medium">{term}</dt>
                <dd className="text-sm text-muted-foreground">{description}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </PageContainer>
  );
}

const rowClass =
  "group flex items-center justify-between gap-4 px-(--card-spacing) py-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

function RowChevron() {
  return (
    <ChevronRight
      className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
      aria-hidden="true"
    />
  );
}

/** Una fila por página: ícono, nombre y lo que responde, en una línea. */
function LinkList({
  links,
}: {
  links: readonly {
    href: string;
    label: string;
    icon: LucideIcon;
    detail: string;
  }[];
}) {
  return (
    <ul className="divide-y">
      {links.map(({ href, label, icon: Icon, detail }) => (
        <li key={href}>
          <Link href={href as Route} className={rowClass}>
            <span className="flex min-w-0 items-start gap-3">
              <Icon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">{detail}</span>
              </span>
            </span>
            <RowChevron />
          </Link>
        </li>
      ))}
    </ul>
  );
}
