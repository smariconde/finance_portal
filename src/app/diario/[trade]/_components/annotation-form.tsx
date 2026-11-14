"use client";

import { Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Segmented } from "@/app/_components/segmented";
import { formatDateTime } from "@/app/_components/trading-format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  ADHERENCE_RULES,
  EMOTIONS,
  EMPTY_ANNOTATION,
  NOTES_MAX,
  type AdherenceMark,
  type AdherenceRule,
  type Emotion,
  type ReviewStatus,
  type TradeAnnotation,
} from "@/modules/trading/domain/trade-annotation";
import type { TradingSetup } from "@/modules/trading/domain/trading-setups";

import { createOwnSetup, saveTradeAnnotation } from "../../actions";
import {
  ADHERENCE_LABELS,
  EMOTION_LABELS,
} from "../../_components/journal-labels";

type PlanField = "entry" | "stop" | "target" | "quantity";

const PLAN_FIELDS: readonly { field: PlanField; label: string }[] = [
  { field: "entry", label: "Entrada" },
  { field: "stop", label: "Stop" },
  { field: "target", label: "Target" },
  { field: "quantity", label: "Cantidad" },
];

const ADHERENCE_OPTIONS: readonly {
  value: "none" | "kept" | "broken";
  label: string;
}[] = [
  { value: "none", label: "—" },
  { value: "kept", label: "Cumplí" },
  { value: "broken", label: "Rompí" },
];

const REVIEW_OPTIONS: readonly { value: ReviewStatus; label: string }[] = [
  { value: "pending", label: "Sin revisar" },
  { value: "reviewed", label: "Revisado" },
];

/** Un decimal canónico como lo escribe el owner en `es-AR`: coma decimal. */
const toInput = (value: string | null) => value?.replace(".", ",") ?? "";

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "conflict" }
  | { readonly kind: "invalid"; readonly field: string }
  | { readonly kind: "failed" };

/** Botones que se prenden y se apagan: `aria-pressed` dice el estado, no el color. */
function Chip({
  pressed,
  onClick,
  children,
}: {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-md border px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
        pressed &&
          "border-primary/50 bg-primary/10 text-foreground ring-1 ring-primary/30",
      )}
    >
      {children}
    </button>
  );
}

function FieldLabel({
  children,
  htmlFor,
  id,
}: {
  readonly children: React.ReactNode;
  readonly htmlFor?: string;
  readonly id?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      id={id}
      className="text-xs font-medium text-muted-foreground"
    >
      {children}
    </label>
  );
}

export function AnnotationForm({
  tradeRef,
  annotation,
  revision,
  recordedAt,
  setups,
}: {
  readonly tradeRef: string;
  readonly annotation: TradeAnnotation | null;
  readonly revision: number | null;
  readonly recordedAt: string | null;
  readonly setups: readonly TradingSetup[];
}) {
  const router = useRouter();
  const id = useId();
  const initial = annotation ?? EMPTY_ANNOTATION;
  const [setupCode, setSetupCode] = useState(initial.setupCode);
  const [catalog, setCatalog] = useState(setups);
  const [plan, setPlan] = useState<Record<PlanField, string>>({
    entry: toInput(initial.plan.entry),
    stop: toInput(initial.plan.stop),
    target: toInput(initial.plan.target),
    quantity: toInput(initial.plan.quantity),
  });
  const [adherence, setAdherence] = useState(initial.adherence);
  const [emotion, setEmotion] = useState<Emotion | null>(initial.emotion);
  const [review, setReview] = useState<ReviewStatus>(initial.review);
  const [notes, setNotes] = useState(initial.notes);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [adding, setAdding] = useState(false);
  const [newSetup, setNewSetup] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [creating, startCreating] = useTransition();

  function touch<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setDirty(true);
      if (status.kind !== "conflict") setStatus({ kind: "idle" });
    };
  }

  function save() {
    startSaving(async () => {
      const result = await saveTradeAnnotation({
        ref: tradeRef,
        baseRevision: revision,
        setupCode,
        plan,
        adherence,
        emotion,
        review,
        notes,
      });
      switch (result.state) {
        case "saved":
        case "unchanged":
          setDirty(false);
          setStatus({ kind: "idle" });
          router.refresh();
          return;
        case "conflict":
          setStatus({ kind: "conflict" });
          return;
        case "invalid":
          setStatus({ kind: "invalid", field: result.field });
          return;
        default:
          setStatus({ kind: "failed" });
      }
    });
  }

  function addSetup() {
    setSetupError(null);
    startCreating(async () => {
      const result = await createOwnSetup({ label: newSetup });
      if (result.state === "created" || result.state === "exists") {
        if (!catalog.some((setup) => setup.code === result.code)) {
          setCatalog([
            ...catalog,
            { code: result.code, label: result.label, origin: "own" },
          ]);
        }
        touch(setSetupCode)(result.code);
        setNewSetup("");
        setAdding(false);
        return;
      }
      setSetupError(
        result.state === "limit_reached"
          ? "Llegaste al máximo de setups propios."
          : result.state === "invalid"
            ? "Nombre inválido: letras, números y puntuación simple."
            : "No se pudo guardar el setup.",
      );
    });
  }

  const invalidField = status.kind === "invalid" ? status.field : null;
  const notesId = `${id}-notes`;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2">Plan y anotación</CardTitle>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {dirty
            ? "Sin guardar"
            : recordedAt === null
              ? "Sin anotar"
              : `Guardado ${formatDateTime(recordedAt)}`}
        </span>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-6 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
        >
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">
                Setup
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {catalog.map((setup) => (
                  <Chip
                    key={setup.code}
                    pressed={setupCode === setup.code}
                    onClick={() =>
                      touch(setSetupCode)(
                        setupCode === setup.code ? null : setup.code,
                      )
                    }
                  >
                    {setup.label}
                  </Chip>
                ))}
                {adding ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-8"
                    onClick={() => setAdding(true)}
                  >
                    <Plus data-icon="inline-start" />
                    Propio
                  </Button>
                )}
              </div>
              {adding ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="Nombre del setup propio"
                    value={newSetup}
                    maxLength={40}
                    autoFocus
                    onChange={(event) => setNewSetup(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSetup();
                      }
                      if (event.key === "Escape") setAdding(false);
                    }}
                    aria-invalid={setupError !== null}
                    className="max-w-56"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={creating || newSetup.trim().length < 2}
                    onClick={addSetup}
                  >
                    {creating ? <Spinner data-icon="inline-start" /> : null}
                    Agregar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setAdding(false)}
                  >
                    Cancelar
                  </Button>
                  {setupError === null ? null : (
                    <p role="alert" className="w-full text-xs text-destructive">
                      {setupError}
                    </p>
                  )}
                </div>
              ) : null}
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-xs font-medium text-muted-foreground">
                Plan
              </legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {PLAN_FIELDS.map(({ field, label }) => {
                  const inputId = `${id}-${field}`;
                  const invalid = invalidField === `plan.${field}`;
                  return (
                    <div key={field} className="flex flex-col gap-1">
                      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
                      <Input
                        id={inputId}
                        inputMode="decimal"
                        autoComplete="off"
                        className="numeric"
                        value={plan[field]}
                        aria-invalid={invalid}
                        aria-describedby={
                          invalid ? `${inputId}-error` : undefined
                        }
                        onChange={(event) =>
                          touch(setPlan)({
                            ...plan,
                            [field]: event.target.value,
                          })
                        }
                      />
                      {invalid ? (
                        <span
                          id={`${inputId}-error`}
                          className="text-xs text-destructive"
                        >
                          Número positivo, con coma o punto.
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">
                Estado al operar
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {EMOTIONS.map((value) => (
                  <Chip
                    key={value}
                    pressed={emotion === value}
                    onClick={() =>
                      touch(setEmotion)(emotion === value ? null : value)
                    }
                  >
                    {EMOTION_LABELS[value]}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="flex flex-col gap-5">
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-muted-foreground">
                Adherencia al plan
              </legend>
              <ul className="flex flex-col divide-y rounded-lg border">
                {ADHERENCE_RULES.map((rule: AdherenceRule) => (
                  <li
                    key={rule}
                    className="flex items-center justify-between gap-3 px-3 py-1.5"
                  >
                    <span className="text-sm">{ADHERENCE_LABELS[rule]}</span>
                    <Segmented
                      label={`Adherencia: ${ADHERENCE_LABELS[rule]}`}
                      options={ADHERENCE_OPTIONS}
                      value={adherence[rule] ?? "none"}
                      onChange={(value) =>
                        touch(setAdherence)({
                          ...adherence,
                          [rule]: (value === "none"
                            ? null
                            : value) as AdherenceMark,
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </fieldset>

            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <FieldLabel htmlFor={notesId}>Notas</FieldLabel>
                <span
                  className={cn(
                    "numeric text-xs text-muted-foreground",
                    notes.length > NOTES_MAX && "text-destructive",
                  )}
                >
                  {notes.length.toLocaleString("es-AR")}/
                  {NOTES_MAX.toLocaleString("es-AR")}
                </span>
              </div>
              <textarea
                id={notesId}
                value={notes}
                rows={7}
                aria-invalid={invalidField === "notes"}
                onChange={(event) => touch(setNotes)(event.target.value)}
                className="min-h-32 w-full flex-1 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 md:col-span-2">
            <Segmented
              label="Revisión del trade"
              options={REVIEW_OPTIONS}
              value={review}
              onChange={touch(setReview)}
            />
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Ctrl + Enter
              </span>
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? <Spinner data-icon="inline-start" /> : null}
                Guardar
              </Button>
            </div>
          </div>

          {status.kind === "conflict" ? (
            <Alert className="md:col-span-2" role="alert">
              <AlertTitle>Hay un guardado más nuevo</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                Otra pestaña o equipo guardó este trade.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => router.refresh()}
                >
                  <RefreshCw data-icon="inline-start" />
                  Recargar
                </Button>
              </AlertDescription>
            </Alert>
          ) : status.kind === "failed" ? (
            <p role="alert" className="text-sm text-destructive md:col-span-2">
              No se pudo guardar. Probá de nuevo.
            </p>
          ) : status.kind === "invalid" &&
            !invalidField?.startsWith("plan.") ? (
            <p role="alert" className="text-sm text-destructive md:col-span-2">
              {invalidField === "notes"
                ? "Las notas tienen caracteres que no se guardan o pasan el largo."
                : invalidField === "setupCode"
                  ? "Ese setup ya no existe."
                  : "Revisá los campos."}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
