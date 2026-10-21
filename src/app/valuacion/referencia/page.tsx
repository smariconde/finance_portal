import { FlaskConical, Info } from "lucide-react";
import type { Metadata } from "next";

import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { StatusMark } from "@/app/_components/status-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import {
  DEMO_CURRENT_SYMBOL,
  DEMO_IDENTITY_GRAPH,
} from "@/modules/identity/infrastructure/demo-identity-fixtures";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  formatAmount,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";
import {
  annotateSensitivity,
  collectDeclaredAbsences,
  collectReportedFacts,
  FRESHNESS_POLICY_VERSION,
  readScenarios,
} from "@/modules/valuation/domain/valuation-report";
import {
  buildDemoValuationRun,
  buildDemoValuationRunBeforeAmendment,
} from "@/modules/valuation/infrastructure/demo-valuation-run";

import { AssumptionsTables } from "../_components/run/assumptions-tables";
import { EvidenceTable } from "../_components/run/evidence-table";
import { EquityBridgeTable } from "../_components/run/equity-bridge-table";
import { Field, FieldList, HashValue } from "../_components/run/field";
import { RunChecks } from "../_components/run/run-checks";
import { RunHeadline } from "../_components/run/run-headline";
import { ScenariosTable } from "../_components/run/scenarios-table";
import { SensitivityMatrix } from "../_components/run/sensitivity-matrix";

export const metadata: Metadata = {
  title: "Corrida de referencia | Portal Financiero",
  description:
    "Corrida FCFF determinista sobre un snapshot fijo, con fuentes, freshness, supuestos y sensibilidad visibles.",
};

/**
 * Corrida de referencia del motor (`F1-06`).
 *
 * No es una demo del producto: es la verificación de que el motor reproduce el
 * mismo resultado y el mismo hash en esta instalación, y la superficie donde se
 * lee toda la evidencia que una valuación debe mostrar. Cuando `F2-*` conecte
 * fuentes reales, las corridas sobre empresas reales usan estos mismos
 * componentes.
 *
 * No abre PostgreSQL, no consulta un proveedor y no persiste nada: se calcula
 * en el proceso desde un snapshot fijo con reloj e identificador inyectados.
 * Aun así queda detrás del guard de runtime, porque un entorno trabado no sirve
 * ninguna superficie de datos (ADR 0004).
 */
/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

export default async function ValuationReferencePage() {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice
        health={health}
        surface="La corrida de referencia del motor"
      />
    );
  }

  const run = buildDemoValuationRun();
  const earlierRun = buildDemoValuationRunBeforeAmendment();

  const facts = collectReportedFacts(run);
  const absences = collectDeclaredAbsences(run);
  const sensitivity = annotateSensitivity(run);
  const scenarios = readScenarios(run);
  const checks = run.result?.checks ?? [];
  // Un escenario que pide revisión deja la corrida en revisión: el aviso los
  // cuenta igual que a los de la base.
  const reviewChecks = [
    ...checks,
    ...(run.result?.scenarios?.bear.checks ?? []),
    ...(run.result?.scenarios?.bull.checks ?? []),
  ].filter(
    (check) => check.mode === "require_review" && check.status === "failed",
  );

  const entity = DEMO_IDENTITY_GRAPH.legalEntities.find(
    (candidate) => candidate.legalEntityId === run.subject.legalEntityId,
  );
  const listing = DEMO_IDENTITY_GRAPH.listings.find(
    (candidate) => candidate.listingId === run.subject.listingId,
  );

  const vintages = [
    { run, label: "Vigente" },
    { run: earlierRun, label: "Anterior a la enmienda" },
  ];

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section
          className="flex flex-col gap-3"
          aria-labelledby="valuation-demo-title"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusMark status="ready" label="Motor verificado" />
            <span className="text-xs text-muted-foreground">
              Fase 1 · slice F1-06
            </span>
          </div>
          <h1
            id="valuation-demo-title"
            className="text-2xl font-semibold tracking-tight md:text-3xl"
          >
            Corrida de referencia del motor
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Una corrida FCFF completa sobre un snapshot fijo, con la evidencia
            que la sostiene y los supuestos que la explican. Sirve para dos
            cosas: verificar que el motor reproduce el mismo hash en esta
            instalación, y fijar cómo se muestra la evidencia de cualquier
            valuación futura.
          </p>
        </section>

        <Alert className="border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30">
          <FlaskConical aria-hidden="true" />
          <AlertTitle>Empresa sintética, no una empresa real</AlertTitle>
          <AlertDescription>
            {entity?.legalName ?? "El sujeto de esta corrida"} no existe. Sus
            datos son un snapshot determinista creado para verificar el motor;
            no derivan de ningún proveedor ni de una captura de datos reales. El
            resultado no es una recomendación ni un precio objetivo, y esta
            página no se conecta a ninguna fuente.
          </AlertDescription>
        </Alert>

        <Card size="sm">
          <CardHeader>
            <CardTitle as="h2">Identidad del sujeto valuado</CardTitle>
            <CardDescription>
              Entidad legal, instrumento, listing y programa depositario son
              identidades distintas. El ticker es un valor de búsqueda con
              vigencia, nunca la identidad.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldList className="sm:grid-cols-2 lg:grid-cols-4">
              <Field
                term="Entidad legal"
                hint={entity?.jurisdiction ?? undefined}
              >
                {entity?.legalName ?? "—"}
              </Field>
              <Field
                term="Instrumento valuado"
                hint={`Moneda económica ${run.currency}`}
              >
                Acción ordinaria clase A
              </Field>
              <Field
                term="Listing primario"
                hint={
                  listing === undefined
                    ? undefined
                    : `Cotiza en ${listing.quoteCurrency}`
                }
              >
                {listing?.mic ?? "—"}
              </Field>
              <Field
                term="Símbolo vigente"
                hint="Valor de búsqueda con vigencia, no una clave estable"
              >
                <span className="numeric">{DEMO_CURRENT_SYMBOL.symbol}</span>
              </Field>
            </FieldList>
            {run.subject.depositaryProgramId === null ? null : (
              <p className="mt-4 text-sm text-muted-foreground">
                El programa depositario que da acceso local a este instrumento
                vincula dos securities mediante un ratio versionado; la
                valuación corre sobre la subyacente y no sobre el CEDEAR.
              </p>
            )}
          </CardContent>
        </Card>

        <RunHeadline run={run} />

        {reviewChecks.length === 0 ? null : (
          <Alert>
            <Info aria-hidden="true" />
            <AlertTitle>La corrida quedó marcada para revisión</AlertTitle>
            <AlertDescription>
              {reviewChecks.length} control
              {reviewChecks.length === 1 ? "" : "es"} en modo revisión no pasó.
              El resultado se calculó igual, pero no debe leerse como cerrado
              hasta resolverlos.
            </AlertDescription>
          </Alert>
        )}

        <EvidenceTable
          facts={facts}
          absences={absences}
          policyVersion={FRESHNESS_POLICY_VERSION}
        />

        <AssumptionsTables run={run} />

        <EquityBridgeTable run={run} />

        {scenarios === null ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2" id="scenarios-title">
                Escenarios bear, base y bull
              </CardTitle>
              <CardDescription>
                El snapshot tiene un único conjunto de supuestos, así que no se
                muestra un rango.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ScenariosTable reading={scenarios} currency={run.currency} />
        )}

        {sensitivity === null ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Sensibilidad</CardTitle>
              <CardDescription>
                El snapshot no declara una grilla de sensibilidad, así que no se
                muestra ninguna.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <SensitivityMatrix sensitivity={sensitivity} />
        )}

        <Card>
          <CardHeader className="border-b">
            <CardTitle as="h2">
              El mismo modelo bajo otro corte de conocimiento
            </CardTitle>
            <CardDescription>
              La fuente reexpresó los ingresos FY2024. Leer el modelo antes y
              después del anuncio produce dos corridas con dos hashes, no una
              corrección de la primera.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table containerLabel="Comparación de cortes de conocimiento, tabla desplazable">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Corte</TableHead>
                  <TableHead scope="col">Conocido hasta</TableHead>
                  <TableHead scope="col" className="text-right">
                    Ingresos del año base
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Valor por acción
                  </TableHead>
                  <TableHead scope="col">Hash del resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vintages.map((vintage) => (
                  <TableRow key={vintage.run.valuationRunId}>
                    <TableHead scope="row" className="font-medium">
                      {vintage.label}
                    </TableHead>
                    <TableCell>
                      {vintage.run.provenance.knowledge.knownAt === null ? (
                        <span className="text-muted-foreground">
                          Vista actual
                        </span>
                      ) : (
                        <time
                          className="numeric"
                          dateTime={vintage.run.provenance.knowledge.knownAt}
                        >
                          {formatUtcTimestamp(
                            vintage.run.provenance.knowledge.knownAt,
                          )}
                        </time>
                      )}
                    </TableCell>
                    <TableCell className="numeric text-right">
                      {formatAmount(vintage.run.input.baseRevenue.value)}{" "}
                      <span className="text-xs text-muted-foreground">
                        {vintage.run.input.baseRevenue.currency}
                      </span>
                    </TableCell>
                    <TableCell className="numeric text-right font-medium">
                      {vintage.run.result === null
                        ? "—"
                        : formatAmount(vintage.run.result.valuePerShare)}
                    </TableCell>
                    <TableCell>
                      {vintage.run.resultHash === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <HashValue hash={vintage.run.resultHash} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <RunChecks run={run} />

        <section
          className="rounded-xl border bg-muted/30 p-4"
          aria-labelledby="limits-title"
        >
          <h2 id="limits-title" className="text-base font-medium">
            Límites de esta superficie
          </h2>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <li>
              No hay proveedores reales, red ni ingesta: la corrida se calcula
              en el proceso desde un snapshot fijo. Las fuentes reales entran en
              Fase 2.
            </li>
            <li>
              Renderizar esta página no abre PostgreSQL ni persiste una corrida,
              en ningún modo.
            </li>
            <li>
              No hay recomendación, precio objetivo, comparación con un precio
              de mercado ni señal de compra o venta.
            </li>
            <li>
              Los supuestos no son editables todavía: el workbench con locks y
              audit trace pertenece a Fase 4.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
