import { FlaskConical, Info } from "lucide-react";
import type { Metadata } from "next";

import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
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
    <PageContainer>
      <PageHeader
        id="valuation-demo-title"
        title="Corrida de referencia del motor"
        lead={
          <>
            Una valuación fija que prueba que el motor da siempre el mismo
            resultado.
            <InfoTip title="Para qué sirve">
              <p>
                Es una corrida FCFF completa sobre un snapshot fijo, con la
                evidencia que la sostiene y los supuestos que la explican.
              </p>
              <p>
                Verifica que el motor reproduce el mismo hash en esta
                instalación y fija cómo se muestra la evidencia de cualquier
                valuación.
              </p>
              <p>
                No usa proveedores, red ni la base: se calcula en el proceso, y
                los supuestos no se editan, porque lo que el hash verifica es
                justamente que no cambien.
              </p>
            </InfoTip>
          </>
        }
        actions={<StatusMark status="ready" label="Motor verificado" />}
      />

      <Alert className="border-warning-border bg-warning-surface">
        <FlaskConical aria-hidden="true" />
        <AlertTitle>Empresa sintética, no una empresa real</AlertTitle>
        <AlertDescription>
          {entity?.legalName ?? "El sujeto de esta corrida"} no existe: sus
          datos son fijos y no salen de ninguna fuente. No es una recomendación
          ni un precio objetivo.
        </AlertDescription>
      </Alert>

      <Card size="sm">
        <CardHeader>
          <div className="flex items-center gap-0.5">
            <CardTitle as="h2">Identidad del sujeto valuado</CardTitle>
            <InfoTip title="Cuatro identidades">
              <p>
                Entidad legal, instrumento, listing y programa depositario son
                identidades distintas. El ticker es un valor de búsqueda con
                vigencia, nunca la identidad.
              </p>
              {run.subject.depositaryProgramId === null ? null : (
                <p>
                  El programa depositario vincula dos securities con un ratio
                  versionado; la valuación corre sobre la subyacente, no sobre
                  el CEDEAR.
                </p>
              )}
            </InfoTip>
          </div>
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
            <Field term="Símbolo vigente">
              <span className="numeric">{DEMO_CURRENT_SYMBOL.symbol}</span>
            </Field>
          </FieldList>
        </CardContent>
      </Card>

      <RunHeadline run={run} />

      {reviewChecks.length === 0 ? null : (
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>La corrida quedó marcada para revisión</AlertTitle>
          <AlertDescription>
            {reviewChecks.length} control
            {reviewChecks.length === 1 ? "" : "es"} en revisión. El resultado se
            calculó igual.
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
          <CardDescription className="flex items-center gap-0.5">
            Ingresos FY2024 reexpresados: dos cortes, dos corridas.
            <InfoTip title="Otro corte de conocimiento">
              <p>
                Leer el modelo antes y después del anuncio produce dos corridas
                con dos hashes, no una corrección de la primera.
              </p>
            </InfoTip>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table containerLabel="Comparación de cortes de conocimiento, tabla desplazable">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Corte</TableHead>
                <TableHead scope="col">Conocido hasta</TableHead>
                <TableHead scope="col" className="text-right">
                  Base-year revenue
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Value per share
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

      <p className="text-sm text-muted-foreground">
        Sin precio de mercado, recomendación ni señal de compra o venta.
      </p>
    </PageContainer>
  );
}
