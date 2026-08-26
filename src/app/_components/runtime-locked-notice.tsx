import { ArrowRight, Lock } from "lucide-react";
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
import type { ConfigHealth } from "@/modules/configuration/domain/config-health";

/**
 * Estado de un runtime trabado
 * ([ADR 0004](../../../docs/architecture/adr/0004-personal-first-runtime.md)).
 *
 * Es deliberadamente una negativa y no una versión reducida del producto. Antes
 * este caso servía fixtures, y esa comodidad hacía que un entorno mal declarado
 * pareciera funcionar. Acá el usuario ve qué falta declarar y nada más.
 *
 * Sólo nombra variables, nunca valores (`TM-02`).
 */
export function RuntimeLockedNotice({
  health,
  surface,
}: {
  health: ConfigHealth;
  surface: string;
}) {
  const missing = [
    ...new Set(health.items.flatMap((item) => item.missingVariables)),
  ];

  return (
    <div id="contenido" className="flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6 lg:p-8">
        <Card>
          <CardHeader className="border-b">
            <CardTitle as="h1" className="flex items-center gap-2 text-lg">
              <Lock className="size-4 shrink-0" aria-hidden="true" />
              Runtime trabado
            </CardTitle>
            <CardDescription>
              {surface} no se sirve porque este entorno no pudo probar que es
              privado.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              El portal guarda datos financieros del owner. Cuando la
              configuración no alcanza para garantizar un límite de acceso
              privado, la respuesta es no responder: no hay una versión pública
              ni un conjunto de datos de reemplazo.
            </p>

            {missing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                El runtime está trabado por declaración explícita de{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  APP_MODE
                </code>
                .
              </p>
            ) : (
              <div>
                <p className="text-sm font-medium">
                  Configuración que falta declarar
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {missing.map((name) => (
                    <li key={name}>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {name}
                      </code>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Se muestran los nombres, nunca los valores.
                </p>
              </div>
            )}

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
