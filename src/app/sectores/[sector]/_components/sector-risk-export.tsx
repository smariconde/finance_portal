"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type ExportState = "idle" | "loading" | "unavailable" | "failed";

/**
 * El CSV de la matriz: valores exactos, motivos de ausencia y fuentes. Una
 * descarga fallida se dice al lado del botón, sin navegar fuera del análisis,
 * y el mismo botón reintenta.
 */
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
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {state === "unavailable" ? (
        <span role="status" className="text-xs text-foreground">
          CSV no habilitado aquí
        </span>
      ) : state === "failed" ? (
        <span role="status" className="text-xs text-foreground">
          No se pudo preparar el CSV
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void download()}
        disabled={state === "loading"}
        title="Valores exactos, motivos de ausencia, fórmulas y fuentes"
      >
        {state === "loading" ? (
          <Spinner className="size-3.5" />
        ) : (
          <Download aria-hidden="true" className="size-3.5" />
        )}
        {state === "loading"
          ? "Preparando CSV…"
          : state === "idle"
            ? "Descargar CSV"
            : "Reintentar CSV"}
      </Button>
    </span>
  );
}
