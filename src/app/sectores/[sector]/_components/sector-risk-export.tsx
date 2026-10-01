"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type ExportState = "idle" | "loading" | "unavailable" | "failed";

/** Una descarga fallida se explica en la matriz, sin navegar fuera del análisis. */
export function SectorRiskExport({
  sectorCode,
}: {
  readonly sectorCode: string;
}) {
  const [state, setState] = useState<ExportState>("idle");

  async function download(): Promise<void> {
    if (state === "loading") return;
    setState("loading");

    try {
      const response = await fetch(`/sectores/${sectorCode}/export`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        setState(response.status === 403 ? "unavailable" : "failed");
        return;
      }

      const contentType = response.headers.get("Content-Type") ?? "";
      if (!contentType.startsWith("text/csv")) {
        setState("failed");
        return;
      }

      const filename = response.headers
        .get("Content-Disposition")
        ?.match(/filename="(riesgo-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.csv)"/u)?.[1];
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename ?? `riesgo-${sectorCode}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="text-xs text-muted-foreground">
        <p>El CSV incluye valores exactos, motivos de ausencia y fuentes.</p>
        {state === "unavailable" ? (
          <p role="status" className="mt-1 text-foreground">
            El export personal no está habilitado en este entorno o sus fuentes.
            Revisá la configuración y volvé a intentar.
          </p>
        ) : state === "failed" ? (
          <p role="status" className="mt-1 text-foreground">
            No se pudo preparar el CSV. Revisá la base personal y volvé a
            intentar.
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void download()}
        disabled={state === "loading"}
      >
        <Download aria-hidden="true" className="size-3.5" />
        {state === "loading" ? "Preparando CSV…" : "Descargar CSV"}
      </Button>
    </div>
  );
}
