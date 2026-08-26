import { ArrowRight, Info, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { StatusMark } from "@/app/_components/status-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getAppConfigHealth } from "@/server/config/app-environment";

const tools = [
  {
    phase: "Fase 2",
    area: "Empresas · CEDEAR",
    question: "¿Qué empresas cumplen mis criterios?",
    description:
      "Filtrado por fundamentales actuales e históricos, con cobertura, fecha y calidad visibles.",
    output: "Screener + ficha",
  },
  {
    phase: "Fase 3",
    area: "Matrices · Divergencias",
    question: "¿Dónde se separaron precio y fundamentales?",
    description:
      "Comparación temporal y puente entre resultados, precio y cantidad de acciones.",
    output: "Matriz + tabla",
  },
  {
    phase: "Fase 4",
    area: "Valuación",
    question: "¿Qué valor explican estos supuestos?",
    description:
      "Escenarios reproducibles y contraste del rango intrínseco con el precio observado.",
    output: "Workbench",
  },
  {
    phase: "Fase 6",
    area: "Argentina · Macro",
    question: "¿Qué está cambiando en el régimen local?",
    description:
      "Nominalidad, liquidez, dólares, actividad y sector externo organizados por preguntas.",
    output: "Tablero por bloques",
  },
  {
    phase: "Fase 6",
    area: "Agro · Soja",
    question: "¿Qué cuenta hoy el precio de la soja?",
    description:
      "Rosario, Chicago, basis y percentil histórico con unidad, ventana y fuente visibles.",
    output: "Serie + contexto",
  },
] as const;

export default function HomePage() {
  const health = getAppConfigHealth();
  const attentionCount = health.items.filter(
    (item) => item.status === "degraded",
  ).length;

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section className="flex flex-col gap-2" aria-labelledby="home-title">
          <h1
            id="home-title"
            className="text-2xl font-semibold tracking-tight md:text-3xl"
          >
            Inicio
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Acceso central a investigación de empresas, valuación y contexto
            local, con datos fechados y supuestos explícitos.
          </p>
        </section>

        <Alert className="border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/30">
          <Info aria-hidden="true" />
          <AlertTitle>Alcance actual del portal</AlertTitle>
          <AlertDescription>
            El portal sirve datos reales sólo en modo personal, sobre un runtime
            local o protegido. Las fuentes todavía no están conectadas: eso
            arranca en Fase 2.
          </AlertDescription>
        </Alert>

        <section
          className="grid gap-4 md:grid-cols-3"
          aria-label="Resumen operativo"
        >
          <Card size="sm">
            <CardHeader>
              <CardDescription>Modo efectivo</CardDescription>
              <CardTitle className="numeric text-xl capitalize">
                {health.mode}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Revisiones pendientes</CardDescription>
              <CardTitle className="numeric text-xl">
                {attentionCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Próximo slice autorizado</CardDescription>
              <CardTitle className="numeric text-xl">F1-07</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.55fr)]">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Buscar una empresa o instrumento</CardTitle>
              <CardDescription>
                La entrada global se habilitará con el universo canónico y sus
                identificadores point-in-time.
              </CardDescription>
              <CardAction>
                <StatusMark status="planned" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  className="pl-9"
                  type="search"
                  placeholder="Ej. MercadoLibre, MELI o MELI.BA"
                  aria-label="Buscar empresa, ticker o CEDEAR (planificado, todavía no disponible)"
                  disabled
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle as="h2">Corrida de referencia del motor</CardTitle>
                <CardDescription>
                  Un snapshot fijo recorre el motor FCFF y debe reproducir
                  siempre el mismo hash. Verifica el cálculo, no una empresa.
                </CardDescription>
                <CardAction>
                  <StatusMark status="ready" label="Disponible" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <Link
                  href="/valuacion/referencia"
                  className={cn(buttonVariants({ size: "sm" }))}
                >
                  Abrir la corrida
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle as="h2">Salud de configuración</CardTitle>
                <CardDescription>
                  Estado seguro del runtime, sin exponer credenciales.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <StatusMark
                  status={attentionCount > 0 ? "degraded" : "ready"}
                  label={
                    attentionCount > 0
                      ? `${attentionCount} pendiente${attentionCount === 1 ? "" : "s"}`
                      : "Base lista"
                  }
                />
                <Link
                  href="/configuracion"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                  )}
                >
                  Ver diagnóstico
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>

        <Card>
          <CardHeader className="border-b">
            <CardTitle as="h2">Herramientas del portal</CardTitle>
            <CardDescription>
              Una superficie estándar por tarea; todas comparten estado,
              provenance y convenciones numéricas.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y px-0">
            {tools.map((tool) => (
              <article
                className="grid gap-3 px-4 py-4 md:grid-cols-[9rem_minmax(0,1fr)_9rem_auto] md:items-center"
                key={tool.area}
              >
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {tool.phase}
                  </p>
                  <p className="text-sm font-semibold">{tool.area}</p>
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">{tool.question}</h3>
                  <p className="text-sm text-muted-foreground">
                    {tool.description}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Formato</p>
                  <p className="text-sm font-medium">{tool.output}</p>
                </div>
                <StatusMark status="planned" />
              </article>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Contrato de evidencia
            </CardTitle>
            <CardDescription>
              Cada resultado financiero debe poder leerse y verificarse sin
              abrir una nota auxiliar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Fuente", "Origen verificable"],
                ["Fecha", "Disponible desde"],
                ["Unidad", "Moneda y escala"],
                ["Transformación", "Fórmula versionada"],
              ].map(([term, description]) => (
                <div className="border-l pl-3" key={term}>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {term}
                  </dt>
                  <dd className="mt-1 text-sm font-medium">{description}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
