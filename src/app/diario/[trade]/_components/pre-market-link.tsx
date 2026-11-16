"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { TickerMark } from "@/app/_components/ticker-mark";
import type { IdeaCandidate } from "@/server/trading/trade-entry";

import { linkPreMarketIdea } from "@/app/plan/actions";

export function PreMarketLink({
  tradeRef,
  candidates,
}: {
  readonly tradeRef: string;
  readonly candidates: readonly IdeaCandidate[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        El diario no tiene un plan previo unido a este trade. Elegí una idea
        anterior a la primera ejecución.
      </p>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay ideas elegibles. Podés crear una para un próximo trade en Plan.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {candidates.map((idea) => (
            <li
              key={idea.ideaId}
              className="flex flex-col gap-2 rounded-lg border p-3"
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <TickerMark ticker={idea.symbol} />
                {idea.symbol} · {idea.setupCode ?? "Sin setup"}
              </p>
              <p className="numeric text-xs text-muted-foreground">
                Entrada US$ {idea.entry} · stop US$ {idea.stop} · target US${" "}
                {idea.target} · {idea.quantity} acciones
              </p>
              {idea.notes ? (
                <p className="line-clamp-2 text-xs">{idea.notes}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Revisión {idea.revision} ·{" "}
                <time dateTime={idea.recordedAt}>
                  {new Date(idea.recordedAt).toLocaleString("es-AR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </time>{" "}
                · idea {idea.ideaId.slice(0, 8)}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                aria-label={`Vincular idea ${idea.symbol}, revisión ${idea.revision}, entrada ${idea.entry}, identificador ${idea.ideaId.slice(0, 8)}`}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(idea.ideaId);
                  const result = await linkPreMarketIdea({
                    ideaId: idea.ideaId,
                    tradeRef,
                  });
                  setBusy(null);
                  setMessage(
                    result === "linked"
                      ? "Plan vinculado."
                      : result === "conflict"
                        ? "La idea o el trade ya están vinculados. Recargá."
                        : "No se pudo vincular este plan.",
                  );
                  if (result === "linked") router.refresh();
                }}
              >
                {busy === idea.ideaId ? "Vinculando…" : "Vincular esta idea"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
