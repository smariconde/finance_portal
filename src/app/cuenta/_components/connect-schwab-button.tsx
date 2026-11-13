"use client";

import { ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { connectSchwab, type ConnectSchwabResult } from "../actions";

const FAILURE_COPY: Record<ConnectSchwabResult["state"], string> = {
  unavailable:
    "La conexión no está configurada en este runtime. Revisá Configuración.",
  rights_blocked:
    "Los derechos de las fuentes de Schwab siguen pendientes; no se abre ninguna conexión.",
  failed: "La base de trading no respondió. Probá de nuevo en un momento.",
};

/**
 * Lleva al login de Schwab. La acción emite el `state` y redirige; si vuelve,
 * es con un código que se nombra acá mismo, sin abrir otra pantalla.
 */
export function ConnectSchwabButton({ reconnect }: { reconnect: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ConnectSchwabResult | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            setResult(await connectSchwab({}));
          })
        }
      >
        {pending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
        )}
        {pending
          ? "Abriendo Schwab…"
          : reconnect
            ? "Reconectar con Schwab"
            : "Conectar con Schwab"}
      </Button>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {result === null ? (
          "Te lleva al login de Schwab; la contraseña no pasa por el portal."
        ) : (
          <>
            {FAILURE_COPY[result.state]}
            {result.state === "failed" ? (
              <>
                {" "}
                Referencia{" "}
                <code className="font-mono text-xs">{result.reference}</code>.
              </>
            ) : null}
          </>
        )}
      </p>
    </div>
  );
}
