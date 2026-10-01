import { ArrowRight, DatabaseZap } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * La base personal no respondió a una superficie que la necesita.
 *
 * Comparte forma con `RuntimeLockedNotice` a propósito: es una negativa y no una
 * versión reducida de la página. No muestra el error —puede traer host, puerto o
 * una consulta (`TM-02`)— sino qué pasó y dónde seguir.
 */
export function DataUnavailableNotice({ surface }: { surface: string }) {
  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <Card>
          <CardHeader className="border-b">
            <CardTitle as="h1" className="flex items-center gap-2 text-lg">
              <DatabaseZap className="size-4 shrink-0" aria-hidden="true" />
              Base personal no disponible
            </CardTitle>
            <CardDescription>
              {surface} necesita leer la base personal, y la base no respondió.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              No se muestra nada en su lugar: una matriz sin datos parecería una
              respuesta. Si la base corre en este equipo, se levanta con{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                pnpm db:up
              </code>
              .
            </p>
            <Link
              href="/configuracion"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Ver el diagnóstico completo
              <ArrowRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
