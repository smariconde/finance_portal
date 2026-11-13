import { randomUUID } from "node:crypto";

import {
  ArrowRight,
  DatabaseZap,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import {
  StatusMark,
  type AvailabilityStatus,
} from "@/app/_components/status-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
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
import {
  getSchwabRuntime,
  schwabRightsBlockedBy,
} from "@/server/trading/schwab-connection";

import { ConnectSchwabButton } from "./_components/connect-schwab-button";

export const metadata: Metadata = {
  title: "Cuenta | Portal Financiero",
  description: "Conexión de lectura con la cuenta Schwab del owner.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

const TIME_ZONE = "America/Argentina/Buenos_Aires";

function formatInstant(instant: string): string {
  return new Date(instant).toLocaleString("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  });
}

function formatRemaining(from: string, to: string): string {
  const minutes = Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
  if (minutes < 60) return "menos de una hora";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hora" : `${hours} horas`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const dayText = days === 1 ? "1 día" : `${days} días`;
  return rest === 0 ? dayText : `${dayText} y ${rest} h`;
}

/** Lo que el callback puede decir, y nada más: un valor fuera del mapa se ignora. */
const OUTCOME_COPY: Record<
  string,
  { tone: "ok" | "warn"; title: string; text: string }
> = {
  connected: {
    tone: "ok",
    title: "Cuenta conectada",
    text: "Los tokens quedaron cifrados en la base de trading. El login vale 7 días.",
  },
  denied: {
    tone: "warn",
    title: "Autorización cancelada",
    text: "Cancelaste en Schwab o Schwab negó el pedido. No se guardó nada.",
  },
  state_invalid: {
    tone: "warn",
    title: "El pedido de conexión no vale",
    text: "Venció a los 10 minutos, ya se usó o no corresponde a este navegador. Empezá de nuevo.",
  },
  code_invalid: {
    tone: "warn",
    title: "Schwab no devolvió un código válido",
    text: "No se pidió ningún token. Probá conectar otra vez.",
  },
  rights_blocked: {
    tone: "warn",
    title: "Derechos pendientes",
    text: "Las fuentes de Schwab no tienen sus derechos aprobados; no se pidió ningún token.",
  },
  exchange_failed: {
    tone: "warn",
    title: "Schwab no entregó los tokens",
    text: "El canje del código falló y no se guardó nada. Si se repite, buscá la referencia en el registro.",
  },
  unavailable: {
    tone: "warn",
    title: "La conexión no está configurada",
    text: "Este runtime no tiene la base de trading o las credenciales de Schwab.",
  },
  error: {
    tone: "warn",
    title: "No se pudo completar la conexión",
    text: "Algo falló del lado del portal. La referencia identifica el error en el log del servidor.",
  },
};

const EVENT_COPY: Record<SchwabConnectionEventKind, string> = {
  connected: "Conexión",
  access_refreshed: "Renovación del acceso",
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
  expiring: { mark: "degraded", label: "Vence en menos de 24 h" },
  expired: { mark: "degraded", label: "Login vencido" },
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
    <section className="flex flex-col gap-2" aria-labelledby="cuenta-title">
      <h1
        id="cuenta-title"
        className="text-2xl font-semibold tracking-tight md:text-3xl"
      >
        Cuenta
      </h1>
      <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
        Conexión de lectura con tu cuenta Schwab. El portal no envía, modifica
        ni cancela órdenes: sus fuentes sólo leen, y la app de Schwab tiene un
        límite de cero órdenes.
      </p>
    </section>
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
        <CardDescription>
          La cuenta necesita su propia base y la app de Schwab. El resto del
          portal funciona igual sin ellas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{item.label}</span>
                <StatusMark status={item.status} />
              </div>
              <p className="text-sm text-muted-foreground">{item.message}</p>
              {item.missingVariables.length > 0 ? (
                <p className="flex flex-wrap gap-1.5">
                  {item.missingVariables.map((name) => (
                    <Code key={name}>{name}</Code>
                  ))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <Link
          href="/configuracion"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Ver el diagnóstico completo
          <ArrowRight data-icon="inline-end" />
        </Link>
      </CardContent>
    </Card>
  );
}

function TradingDatabaseUnavailable({ reference }: { reference: string }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2" className="flex items-center gap-2">
          <DatabaseZap className="size-4 shrink-0" aria-hidden="true" />
          Base de trading no disponible
        </CardTitle>
        <CardDescription>
          La cuenta lee su conexión de la base de trading, y esa base no
          respondió. La base de análisis no interviene.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          No se muestra un estado en su lugar: «sin conectar» sería falso.
          Referencia <Code>{reference}</Code>.
        </p>
      </CardContent>
    </Card>
  );
}

function ConnectionCard({
  status,
  now,
  blockedBy,
}: {
  status: SchwabConnectionStatus;
  now: string;
  blockedBy: readonly string[];
}) {
  const view = STATUS_VIEW[status.status];

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2">Conexión con Schwab</CardTitle>
          <StatusMark status={view.mark} label={view.label} />
        </div>
        <CardDescription>
          Schwab exige un login humano cada 7 días y no deja extenderlo. El
          portal avisa 24 horas antes; nunca guarda tu contraseña.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {status.status === "not_connected" ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay una conexión guardada.
          </p>
        ) : (
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div className="space-y-1">
              <dt className="text-muted-foreground">Último login</dt>
              <dd className="numeric font-medium">
                {formatInstant(status.connectedAt)}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">El login vence</dt>
              <dd className="numeric font-medium">
                {formatInstant(status.refreshExpiresAt)}
              </dd>
              <dd className="text-muted-foreground">
                {status.status === "expired"
                  ? "Ya venció"
                  : `En ${formatRemaining(now, status.refreshExpiresAt)}`}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Aviso desde</dt>
              <dd className="numeric font-medium">
                {formatInstant(status.warnFrom)}
              </dd>
            </div>
          </dl>
        )}

        {status.status === "expiring" ? (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>El login vence pronto</AlertTitle>
            <AlertDescription>
              Reconectá antes del vencimiento para que la cuenta no quede sin
              datos.
            </AlertDescription>
          </Alert>
        ) : null}

        {status.status === "expired" ? (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>El login venció</AlertTitle>
            <AlertDescription>
              Sin reconectar, el portal no puede leer la cuenta. Nada de lo que
              se muestre después se presentará como actual.
            </AlertDescription>
          </Alert>
        ) : null}

        {blockedBy.length > 0 ? (
          <Alert>
            <ShieldCheck aria-hidden="true" />
            <AlertTitle>Derechos de Schwab pendientes</AlertTitle>
            <AlertDescription>
              <p>
                La conexión no se abre hasta revisar el acuerdo que rige la API.
                Motivos:
              </p>
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {blockedBy.map((code) => (
                  <Code key={code}>{code}</Code>
                ))}
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <ConnectSchwabButton reconnect={status.status !== "not_connected"} />
        )}
      </CardContent>
    </Card>
  );
}

function EventsCard({ events }: { events: readonly SchwabConnectionEvent[] }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Registro de la conexión</CardTitle>
        <CardDescription>
          Los últimos eventos, con su código y la referencia del pedido. Nunca
          guarda un token ni un código de autorización.
        </CardDescription>
      </CardHeader>
      <CardContent className={events.length === 0 ? undefined : "px-0"}>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay eventos.
          </p>
        ) : (
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
                  <TableCell className="text-muted-foreground">
                    {event.requestId === null ? (
                      "—"
                    ) : (
                      <span className="font-mono text-xs">
                        {event.requestId}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
      // Sólo el tipo: el mensaje puede traer host o SQL (`TM-02`).
      console.error(
        "account read failed",
        failure,
        error instanceof Error ? error.name : typeof error,
      );
    }

    body =
      reading === null ? (
        <TradingDatabaseUnavailable reference={failure} />
      ) : (
        <>
          <ConnectionCard
            status={reading.status}
            now={now}
            blockedBy={schwabRightsBlockedBy()}
          />
          <EventsCard events={reading.events} />
        </>
      );
  }

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <PageHeader />
        {outcome !== null ? (
          <Alert role="status">
            {outcome.tone === "ok" ? (
              <ShieldCheck aria-hidden="true" />
            ) : (
              <TriangleAlert aria-hidden="true" />
            )}
            <AlertTitle>{outcome.title}</AlertTitle>
            <AlertDescription>
              {outcome.text}
              {shownReference !== null ? (
                <>
                  {" "}
                  Referencia <Code>{shownReference}</Code>.
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {body}
      </div>
    </div>
  );
}
