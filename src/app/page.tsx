import {
  ArrowRight,
  Calculator,
  ChartScatter,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusMark } from "@/app/_components/status-mark";
import { ValuationRequestForm } from "@/app/valuacion/_components/valuation-request-form";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";

/**
 * Lo que el backlog y el roadmap tienen por delante, en su orden
 * ([06_PHASED_ROADMAP](../../docs/finance-portal-masterplan/06_PHASED_ROADMAP.md)).
 * No hay screener: el filtrado amplio se hace con Finviz (ADR 0016).
 */
const upcoming = [
  {
    phase: "F6-25",
    status: "Planificado",
    area: "Ficha de la empresa",
    question: "¿Cómo se compara con su propia historia?",
    description:
      "Múltiplos elegidos por arquetipo y su historia reportada en barras, calculados con SEC y precios guardados.",
  },
  {
    phase: "Fase 8",
    status: "En desarrollo",
    area: "Divergencias fundamentales",
    question: "¿Dónde se separaron precio y fundamentales?",
    description:
      "Market cap contra EPS por sector, con el sesgo de recompras a la vista y los extremos sin evidencia nombrados.",
  },
  {
    phase: "Fase 9",
    status: "Planificado",
    area: "Argentina · Macro",
    question: "¿Qué está cambiando en el régimen local?",
    description:
      "BCRA, INDEC y cambiario con fuentes oficiales, vintages y transformaciones nominal/real auditables.",
  },
  {
    phase: "Fase 9",
    status: "Planificado",
    area: "Agro · Soja",
    question: "¿Qué cuenta hoy el precio de la soja?",
    description:
      "Rosario y Chicago con contrato, conversión y tipo de cambio declarados antes de calcular el basis.",
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

export default async function HomePage() {
  const health = await getRequestConfigHealth();
  const live = servesRealData(health);
  const attentionCount = health.items.filter(
    (item) => item.status === "degraded",
  ).length;

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6 lg:p-8">
        <section className="flex flex-col gap-2" aria-labelledby="home-title">
          <h1
            id="home-title"
            className="text-2xl font-semibold tracking-tight md:text-3xl"
          >
            Inicio
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Valuación de empresas del S&amp;P 500 con su acceso vía CEDEAR y
            matrices de riesgo por sector. Cada cifra conserva su fuente, su
            fecha y la regla que la produjo.
          </p>
        </section>

        <section
          className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
          aria-label="Herramientas disponibles"
        >
          <Card>
            <CardHeader>
              <CardTitle
                as="h2"
                className="flex items-center gap-2 text-lg font-semibold"
              >
                <Calculator
                  className="size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                Valuar una empresa
              </CardTitle>
              <CardDescription className="max-w-prose">
                Escribí un ticker del índice. Se baja de la SEC lo que falte, se
                audita la empresa y el valor por acción aparece junto al precio,
                lo que el precio exige y su equivalente por CEDEAR.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {live ? (
                <ValuationRequestForm />
              ) : (
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <StatusMark status="disabled" label="Runtime trabado" />
                  Este runtime no sirve datos, así que no puede valuar.
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Empresas en pérdida o de alto crecimiento y REITs todavía no se
                valúan desde acá: sus motores corren sólo por línea de comandos.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle
                as="h2"
                className="flex items-center gap-2 text-lg font-semibold"
              >
                <ChartScatter
                  className="size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                Riesgo por sector
              </CardTitle>
              <CardDescription className="max-w-prose">
                Sortino a 2 y a 5 años de cada empresa de un sector contra el
                S&amp;P 500 Total Return, con las que tienen CEDEAR
                distinguidas. Al abrir un sector se bajan sólo los precios que
                le falten.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Link
                href="/sectores"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Ver los once sectores
                <ArrowRight data-icon="inline-end" />
              </Link>
            </CardContent>
          </Card>
        </section>

        <section
          className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
          aria-label="Roadmap y verificación"
        >
          <Card>
            <CardHeader className="border-b">
              <CardTitle as="h2">En camino</CardTitle>
              <CardDescription>
                Lo próximo del roadmap. Aparece en la navegación marcado como
                planificado y no responde hasta que exista.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <ul className="divide-y">
                {upcoming.map((item) => (
                  <li
                    key={item.area}
                    className="grid gap-x-4 gap-y-1 px-(--card-spacing) py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-sm">
                        <span className="font-medium">{item.area}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {item.phase}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {item.question} {item.description}
                      </p>
                    </div>
                    <div className="sm:pt-0.5">
                      <StatusMark status="planned" label={item.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle as="h2">Verificación</CardTitle>
              <CardDescription>
                Cómo comprobar el motor y el runtime sin depender de una
                empresa.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <ul className="divide-y">
                <li>
                  <Link
                    href="/valuacion/referencia"
                    className="group flex items-center justify-between gap-4 px-(--card-spacing) py-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        Corrida de referencia del motor
                      </span>
                      <span className="text-sm text-muted-foreground">
                        Un snapshot fijo que debe reproducir siempre el mismo
                        hash.
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
                <li>
                  <Link
                    href="/configuracion"
                    className="group flex items-center justify-between gap-4 px-(--card-spacing) py-3 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
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
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <section
          className="flex flex-col gap-4 border-t pt-6"
          aria-labelledby="evidence-title"
        >
          <h2
            id="evidence-title"
            className="flex items-center gap-2 text-base font-medium"
          >
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Contrato de evidencia
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {evidenceContract.map(([term, description]) => (
              <div className="flex flex-col gap-1" key={term}>
                <dt className="text-sm font-medium">{term}</dt>
                <dd className="text-sm text-muted-foreground">{description}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
