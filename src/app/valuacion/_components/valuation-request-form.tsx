"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { enqueueValuation } from "../actions";

/**
 * Entrada de la valuación por ticker (`F6-01`, rediseñada en `F6-12`).
 *
 * Encola con la acción de `F6-01` y lleva a la página del ticker, que sigue el
 * pedido en el lugar y se actualiza al terminar. Así hay un solo lugar donde
 * mirar una empresa: esta página no muestra estados ni resultados.
 */
export function ValuationRequestForm() {
  const router = useRouter();
  // El formulario vive en el inicio y en `/valuacion`. Con Cache Components la
  // ruta anterior queda montada y oculta, así que un `id` fijo se repetía y el
  // `<label>` nombraba al campo escondido.
  const inputId = useId();
  const [ticker, setTicker] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [navigating, startNavigation] = useTransition();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);

    try {
      const view = await enqueueValuation({ ticker, intent: "enqueue" });

      if (view.state === "idle" || view.state === "unavailable") {
        setFailed(true);
        return;
      }

      startNavigation(() => {
        router.push(`/valuacion/${encodeURIComponent(view.ticker)}`);
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const busy = pending || navigating;

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={onSubmit}
      >
        <div className="flex w-full max-w-xs flex-col gap-2">
          <label className="text-sm font-medium" htmlFor={inputId}>
            Ticker
          </label>
          <Input
            id={inputId}
            name="ticker"
            value={ticker}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            required
            disabled={busy}
            className="max-md:h-11 font-mono uppercase"
            onChange={(event) => setTicker(event.target.value)}
          />
        </div>
        <Button className="max-md:h-11" disabled={busy} type="submit">
          {busy ? "Abriendo" : "Valuar"}
        </Button>
      </form>
      <p aria-live="polite" className="max-w-prose text-sm" role="status">
        {failed
          ? "No se pudo pedir la valuación. Revisá que sea un símbolo, como AAPL, y que este runtime pueda leer la base."
          : null}
      </p>
    </div>
  );
}
