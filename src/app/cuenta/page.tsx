import { randomUUID } from "node:crypto";

import {
  ArrowRight,
  DatabaseZap,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import {
  StatusMark,
  type AvailabilityStatus,
} from "@/app/_components/status-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  servesRealData,
  servesSchwabConnection,
  type ConfigHealth,
} from "@/modules/configuration/domain/config-health";
import { readSchwabConnectionStatus } from "@/modules/trading/application/schwab-connection-service";
import type {
  SchwabConnectionEvent,
  SchwabConnectionEventKind,
} from "@/modules/trading/application/schwab-connection-store";
import type { SchwabConnectionStatus } from "@/modules/trading/domain/schwab-connection-status";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { safeErrorSummary } from "@/server/trading/safe-error";
import {
  getSchwabRuntime,
  schwabRightsBlockedBy,
} from "@/server/trading/schwab-connection";

import { ConnectSchwabButton } from "./_components/connect-schwab-button";
import {
  LiveAccountSection,
  LiveAccountSkeleton,
} from "./_components/live-account-section";

export const metadata: Metadata = {
  title: "Cuenta | Portal Financiero",
  description:
    "Cuenta Schwab del owner en modo lectura: saldos, posiciones y órdenes abiertas.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

const TIME_ZONE = "America/Argentina/Buenos_Aires";

function formatInstant(instant: string): string {
  return new Date(instant).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  });
}

function formatRemaining(from: string, to: string): string {
  const minutes = Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
  if (minutes < 60) return "menos de 1 h";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days} d` : `${days} d ${rest} h`;
}

/** Lo que el callback puede decir, y nada más: un valor fuera del mapa se ignora. */
const OUTCOME_COPY: Record<string, { tone: "ok" | "warn"; title: string }> = {
  connected: { tone: "ok", title: "Cuenta conectada" },
  denied: { tone: "warn", title: "Autorización cancelada en Schwab" },
  state_invalid: {
    tone: "warn",
    title: "El pedido de conexión venció o no es de este navegador",
  },
  code_invalid: { tone: "warn", title: "Schwab no devolvió un código válido" },
  rights_blocked: { tone: "warn", title: "Derechos de Schwab pendientes" },
  exchange_failed: { tone: "warn", title: "Schwab no entregó los tokens" },
  unavailable: { tone: "warn", title: "La conexión no está configurada" },
  error: { tone: "warn", title: "No se pudo completar la conexión" },
};

const EVENT_COPY: Record<SchwabConnectionEventKind, string> = {
  connected: "Conexión",
  access_refreshed: "Renovación",
  refresh_failed: "Renovación fallida",
  exchange_failed: "Canje fallido",
  callback_rejected: "Vuelta rechazada",
  disconnected: "Desconexión",
};

const STATUS_VIEW: Record<
  SchwabConnectionStatus["status"],
  { mark: AvailabilityStatus; label: string }
> = {
  connected: { mark: "ready", label: "Conectada" },
  expiring: { mark: "degraded", label: "Vence pronto" },
  expired: { mark: "degraded", label: "Login vencido" },
  renewal_failed: { mark: "degraded", label: "Reconectar" },
  not_connected: { mark: "disabled", label: "Sin conectar" },
};

const REFERENCE_PATTERN = /^[0-9a-f-]{36}$/u;

function first(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

function PageHeader() {
  return (
    <h1
      id="cuenta-title"
      className="text-2xl font-semibold tracking-tight md:text-3xl"
    >
      Cuenta
    </h1>
  );
}

function ConfigurationNeeded({ health }: { health: ConfigHealth }) {
  const items = health.items.filter(
    (item) => item.id === "trading" || item.id === "schwab",
  );

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Falta configuración</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{item.label}</span>
              <StatusMark status={item.status} />
              {item.missingVariables.map((name) => (
                <Code key={name}>{name}</Code>
              ))}
            </li>
          ))}
        </ul>
        <Link
          href="/configuracion"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Diagnóstico completo
          <ArrowRight data-icon="inline-end" />
        </Link>
      </CardContent>
    </Card>
  );
}

function TradingDatabaseUnavailable({ reference }: { reference: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <DatabaseZap className="size-4 shrink-0" aria-hidden="true" />
          Base de trading no disponible
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Referencia <Code>{reference}</Code>
      </CardContent>
    </Card>
  );
}

/**
 * La conexión en una franja: estado, cuándo vence el login semanal y el botón.
 * El registro queda plegado: se mira cuando algo falla.
 */
function ConnectionPanel({
  status,
  now,
  blockedBy,
  events,
}: {
  status: SchwabConnectionStatus;
  now: string;
  blockedBy: readonly string[];
  events: readonly SchwabConnectionEvent[];
}) {
  const view = STATUS_VIEW[status.status];
  const needsAction = status.status !== "connected";

  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1 text-sm font-medium">
              Schwab
              <InfoTip title="Conexión con Schwab">
                <p>
                  Solo lectura: el portal no envía órdenes y la app de Schwab
                  tiene un límite de cero.
                </p>
                <p>
                  Schwab pide un login cada 7 días y admite{" "}
                  <strong>uno solo activo</strong>: conectar en otro entorno
                  invalida este.
                </p>
              </InfoTip>
            </span>
            <StatusMark status={view.mark} label={view.label} />
            {status.status === "not_connected" ? null : (
              <span className="text-sm text-muted-foreground">
                {status.status === "expired" ? (
                  "Venció"
                ) : (
                  <>
                    Vence{" "}
                    <time
                      dateTime={status.refreshExpiresAt}
                      className="numeric"
                    >
                      {formatInstant(status.refreshExpiresAt)}
                    </time>{" "}
                    <span className="numeric">
                      ({formatRemaining(now, status.refreshExpiresAt)})
                    </span>
                  </>
                )}
              </span>
            )}
          </div>
          {blockedBy.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Derechos pendientes
              {blockedBy.map((code) => (
                <Code key={code}>{code}</Code>
              ))}
            </span>
          ) : (
            <ConnectSchwabButton
              reconnect={status.status !== "not_connected"}
              urgent={needsAction}
            />
          )}
        </div>

        {events.length === 0 ? null : (
          <details className="group text-sm">
            <summary className="cursor-pointer text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              Registro
            </summary>
            <Table containerLabel="Registro de la conexión, tabla desplazable">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Referencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.eventId}>
                    <TableCell className="numeric whitespace-nowrap">
                      {formatInstant(event.occurredAt)}
                    </TableCell>
                    <TableCell>{EVENT_COPY[event.kind]}</TableCell>
                    <TableCell>
                      <Code>{event.code}</Code>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {event.requestId ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const health = await getRequestConfigHealth();

  if (!servesRealData(health)) {
    return <RuntimeLockedNotice health={health} surface="La cuenta" />;
  }

  const query = await searchParams;
  const outcome = OUTCOME_COPY[first(query.schwab) ?? ""] ?? null;
  const reference = first(query.ref);
  const shownReference =
    reference !== null && REFERENCE_PATTERN.test(reference) ? reference : null;

  let body: React.ReactNode;

  if (!servesSchwabConnection(health)) {
    body = <ConfigurationNeeded health={health} />;
  } else {
    const now = new Date().toISOString();
    let reading: {
      status: SchwabConnectionStatus;
      events: SchwabConnectionEvent[];
    } | null = null;
    const failure = randomUUID();

    try {
      const { dependencies } = getSchwabRuntime();
      const [status, events] = await Promise.all([
        readSchwabConnectionStatus({
          store: dependencies.store,
          now: () => now,
        }),
        dependencies.store.listEvents(10),
      ]);
      reading = { status, events };
    } catch (error) {
      // Tipo y código del driver; el mensaje puede traer host o SQL (`TM-02`).
      console.error("account read failed", failure, safeErrorSummary(error));
    }

    body =
      reading === null ? (
        <TradingDatabaseUnavailable reference={failure} />
      ) : (
        <>
          {reading.status.status === "connected" ||
          reading.status.status === "expiring" ? (
            <Suspense fallback={<LiveAccountSkeleton />}>
              <LiveAccountSection />
            </Suspense>
          ) : null}
          <ConnectionPanel
            status={reading.status}
            now={now}
            blockedBy={schwabRightsBlockedBy()}
            events={reading.events}
          />
        </>
      );
  }

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <PageHeader />
        {outcome !== null ? (
          <Alert role="status">
            {outcome.tone === "ok" ? (
              <ShieldCheck aria-hidden="true" />
            ) : (
              <TriangleAlert aria-hidden="true" />
            )}
            <AlertTitle>{outcome.title}</AlertTitle>
            {shownReference !== null ? (
              <AlertDescription>
                Referencia <Code>{shownReference}</Code>
              </AlertDescription>
            ) : null}
          </Alert>
        ) : null}
        {body}
      </div>
    </div>
  );
}
