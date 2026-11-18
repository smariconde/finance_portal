"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { declareForwardPeThreshold } from "../../actions";

const VALUE_PATTERN = /^(?:[1-9]\d{0,2})(?:[.,]\d{1,2})?$/u;

/**
 * The owner's forward P/E threshold for this company (ADR 0083): a line on the
 * chart, never a label on the company. Saving writes a new revision; «Quitar»
 * writes one without a value.
 */
export function ForwardPeThreshold({
  ticker,
  current,
}: {
  readonly ticker: string;
  /** The threshold in force, as the owner typed it, or `null`. */
  readonly current: string | null;
}) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(current?.replace(".", ",") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (next: string | null) => {
    if (next !== null && !VALUE_PATTERN.test(next.trim())) {
      setError("Un múltiplo entre 1 y 999, hasta dos decimales.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await declareForwardPeThreshold({
        ticker,
        value: next === null ? null : next.trim(),
      });
      if (result.state === "saved") {
        if (next === null) setValue("");
        router.refresh();
      } else {
        setError("No se pudo guardar el umbral.");
      }
    });
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit(value);
      }}
    >
      <label
        htmlFor={inputId}
        className="flex flex-col gap-1 text-xs font-medium text-muted-foreground"
      >
        Tu umbral de forward P/E
        <span className="flex items-center gap-1">
          <Input
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : errorId}
            className="numeric w-20 text-right"
          />
          <span aria-hidden="true" className="text-sm text-foreground">
            ×
          </span>
        </span>
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner aria-hidden="true" /> : null}
        Guardar
      </Button>
      {current === null ? null : (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => submit(null)}
        >
          Quitar
        </Button>
      )}
      {error === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="w-full text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </form>
  );
}
