import { Info } from "lucide-react";
import type { Metadata } from "next";

import {
  StatusMark,
  type AvailabilityStatus,
} from "@/app/_components/status-mark";
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
import { getAppConfigHealth } from "@/server/config/app-environment";

export const metadata: Metadata = {
  title: "Configuración | Portal Financiero",
  description: "Estado seguro de configuración y capacidades del portal.",
};

const stateGuide: Array<{
  status: AvailabilityStatus;
  meaning: string;
}> = [
  {
    status: "ready",
    meaning: "La capacidad puede usarse dentro del alcance actual.",
  },
  {
    status: "degraded",
    meaning: "La app sigue operativa, pero existe una condición para revisar.",
  },
  {
    status: "disabled",
    meaning: "La capacidad existe como contrato, pero está bloqueada por modo.",
  },
  {
    status: "planned",
    meaning: "Pertenece al roadmap y todavía no se implementó.",
  },
];

export default function ConfigurationPage() {
  const health = getAppConfigHealth();

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <section className="flex flex-col gap-2" aria-labelledby="config-title">
          <h1
            id="config-title"
            className="text-2xl font-semibold tracking-tight md:text-3xl"
          >
            Configuración
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Diagnóstico seguro de runtime y capacidades. Sólo se muestran
            nombres y presencia de configuración server-only, nunca valores
            secretos.
          </p>
        </section>

        <section
          className="grid gap-4 md:grid-cols-3"
          aria-label="Resumen de configuración"
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
              <CardDescription>Límite de acceso</CardDescription>
              <CardTitle className="numeric text-xl capitalize">
                {health.access}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Controles evaluados</CardDescription>
              <CardTitle className="numeric text-xl">
                {health.items.length}
              </CardTitle>
            </CardHeader>
          </Card>
        </section>

        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>Diagnóstico sin efectos laterales</AlertTitle>
          <AlertDescription>
            Esta página no abre conexiones, no llama proveedores y no revela
            payloads de configuración.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="border-b">
            <CardTitle as="h2">Cómo leer los estados</CardTitle>
            <CardDescription>
              Icono y texto preservan el significado aun cuando el color no está
              disponible.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-1 sm:grid-cols-2 xl:grid-cols-4">
            {stateGuide.map((state) => (
              <div className="space-y-2" key={state.status}>
                <StatusMark status={state.status} />
                <p className="text-sm text-muted-foreground">{state.meaning}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle as="h2">Salud de esta instancia</CardTitle>
            <CardDescription>
              Los faltantes muestran el nombre de la variable, nunca su valor.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-[44%]">Lectura</TableHead>
                  <TableHead>Configuración</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.label}</TableCell>
                    <TableCell>
                      <StatusMark status={item.status} />
                    </TableCell>
                    <TableCell className="min-w-64 text-muted-foreground">
                      {item.message}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-1 text-xs">
                        {item.missingVariables.length > 0
                          ? item.missingVariables.join(" · ")
                          : "Sin faltantes"}
                      </code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Límite actual del sistema</CardTitle>
            <CardDescription>
              F1-02 incorpora el contrato de persistencia. Postgres sólo se abre
              en modo personal; la demo permanece aislada en fixtures.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <li className="rounded-md border bg-muted/30 px-3 py-2">
                Postgres requiere modo personal y una conexión pooled.
              </li>
              <li className="rounded-md border bg-muted/30 px-3 py-2">
                Sin proveedores ni tráfico externo.
              </li>
              <li className="rounded-md border bg-muted/30 px-3 py-2">
                Sin ingestas, mutaciones persistentes o datos financieros.
              </li>
              <li className="rounded-md border bg-muted/30 px-3 py-2">
                Sin rutas que simulen capacidades futuras.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
