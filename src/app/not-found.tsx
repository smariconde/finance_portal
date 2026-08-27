import { ArrowRight, SearchX } from "lucide-react";
import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Ruta inexistente | Portal Financiero",
  description: "La dirección solicitada no corresponde a ninguna superficie.",
};

/**
 * 404 del portal.
 *
 * Existe por dos motivos. El primero es de producto: la respuesta por defecto de
 * Next.js no comparte el shell y deja al owner sin la navegación que necesita
 * para salir del error. El segundo es técnico: `/_not-found` hereda el layout,
 * que resuelve el modo efectivo durante el request
 * ([ADR 0005](../../docs/architecture/adr/0005-request-time-runtime-boundary.md)),
 * así que la ruta también se sirve entera cuando llega.
 *
 * Deliberadamente no adivina qué buscaba el visitante ni ofrece una búsqueda: el
 * universo canónico y sus identificadores llegan en Fase 2, y sugerir un destino
 * sin poder resolverlo sería inventar una capacidad.
 */
export const instant = false;

export default function NotFoundPage() {
  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <Card>
          <CardHeader className="border-b">
            <CardTitle as="h1" className="flex items-center gap-2 text-lg">
              <SearchX className="size-4 shrink-0" aria-hidden="true" />
              Esa ruta no existe
            </CardTitle>
            <CardDescription>
              El servidor respondió 404: la dirección solicitada no corresponde
              a ninguna superficie del portal.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              El portal sólo sirve las superficies que la navegación enumera.
              Las que todavía no se construyeron aparecen ahí marcadas como
              planificadas, en vez de responder con una página vacía que parezca
              una capacidad disponible.
            </p>
            <p className="text-sm text-muted-foreground">
              Si llegaste desde un enlace guardado, puede apuntar a una ruta que
              cambió de nombre entre slices.
            </p>

            <Link
              href="/"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Volver al inicio
              <ArrowRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
