"use client";

import { ChevronLeft, ChevronRight, Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import {
  formatDateTime,
  formatSession,
} from "@/app/_components/trading-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  MAX_ROUTINE_ITEMS,
  ROUTINE_NOTE_MAX,
  type RoutinePhase,
  type RoutinePhaseReading,
  type RoutineReading,
} from "@/modules/trading/domain/trading-routine";

import {
  addRoutineItem,
  readSessionRoutine,
  retireRoutineItem,
  saveSessionRoutine,
} from "../actions";

const PHASE_LABELS: Readonly<Record<RoutinePhase, string>> = {
  pre_open: "Antes de la apertura",
  close: "Al cierre",
};

const WEEKDAY = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  timeZone: "UTC",
});

function sessionTitle(session: string): string {
  const day = WEEKDAY.format(new Date(`${session}T00:00:00.000Z`));
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${formatSession(session)}`;
}

function PhaseColumn({
  session,
  phase,
  reading,
  editing,
  onSaved,
  onItemsChanged,
}: {
  readonly session: string;
  readonly phase: RoutinePhase;
  readonly reading: RoutinePhaseReading;
  readonly editing: boolean;
  readonly onSaved: (routine: RoutineReading) => void;
  readonly onItemsChanged: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [checked, setChecked] = useState<readonly string[]>(reading.checked);
  const [note, setNote] = useState(reading.note);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [saving, startSaving] = useTransition();
  const [changing, startChanging] = useTransition();

  const open = reading.items.filter((item) => item.retiredAt === null);

  function toggle(itemId: string) {
    setChecked(
      checked.includes(itemId)
        ? checked.filter((value) => value !== itemId)
        : [...checked, itemId],
    );
    setDirty(true);
    setStatus(null);
  }

  function save() {
    startSaving(async () => {
      const result = await saveSessionRoutine({
        session,
        phase,
        baseRevision: reading.revision,
        checked,
        note,
      });
      if (result.state === "saved" || result.state === "unchanged") {
        setDirty(false);
        onSaved(result.routine);
        router.refresh();
        return;
      }
      setStatus(
        result.state === "conflict"
          ? "Otra pestaña guardó antes: recargá la página."
          : "No se pudo guardar.",
      );
    });
  }

  function add() {
    startChanging(async () => {
      const result = await addRoutineItem({ phase, label });
      if (result.state === "done") {
        setLabel("");
        onItemsChanged();
        return;
      }
      setStatus(
        result.state === "limit_reached"
          ? `Máximo ${MAX_ROUTINE_ITEMS} ítems.`
          : result.state === "invalid"
            ? "Texto inválido."
            : "No se pudo agregar.",
      );
    });
  }

  function retire(itemId: string) {
    startChanging(async () => {
      const result = await retireRoutineItem({ itemId });
      if (result.state === "done") onItemsChanged();
      else setStatus("No se pudo quitar.");
    });
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 flex w-full items-baseline justify-between gap-2 text-sm font-medium">
        {PHASE_LABELS[phase]}
        <span className="numeric text-xs font-normal text-muted-foreground">
          {open.length === 0
            ? null
            : `${checked.filter((itemId) => open.some((item) => item.itemId === itemId)).length}/${open.length}`}
        </span>
      </legend>
      {reading.items.length === 0 && !editing ? (
        <p className="text-xs text-muted-foreground">Sin ítems.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {reading.items.map((item) => {
            const inputId = `${id}-${item.itemId}`;
            return (
              <li key={item.itemId} className="flex items-center gap-2">
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked.includes(item.itemId)}
                  onChange={() => toggle(item.itemId)}
                  className="size-4 shrink-0 accent-primary"
                />
                <label
                  htmlFor={inputId}
                  className={cn(
                    "min-w-0 flex-1 py-1 text-sm",
                    item.retiredAt !== null &&
                      "text-muted-foreground line-through",
                  )}
                >
                  {item.label}
                </label>
                {editing && item.retiredAt === null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Quitar ${item.label}`}
                    disabled={changing}
                    onClick={() => retire(item.itemId)}
                  >
                    <X />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Nuevo ítem: ${PHASE_LABELS[phase]}`}
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={changing || label.trim().length < 2}
            onClick={add}
          >
            <Plus data-icon="inline-start" />
            Agregar
          </Button>
        </div>
      ) : null}
      <textarea
        aria-label={`Nota: ${PHASE_LABELS[phase]}`}
        value={note}
        rows={2}
        maxLength={ROUTINE_NOTE_MAX}
        onChange={(event) => {
          setNote(event.target.value);
          setDirty(true);
          setStatus(null);
        }}
        className="min-h-14 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-xs text-muted-foreground",
            status !== null && "text-destructive",
          )}
          aria-live="polite"
        >
          {status ??
            (dirty
              ? "Sin guardar"
              : reading.recordedAt === null
                ? ""
                : `Guardada ${formatDateTime(reading.recordedAt)}`)}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={saving || !dirty}
          onClick={save}
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Guardar
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * La rutina de la sesión (`trading-routine-1.0.0`, `F11-07`): el checklist propio
 * de cada fase y una nota. Opcional: nada la pide ni la bloquea.
 */
export function RoutineCard({ initial }: { readonly initial: RoutineReading }) {
  const [routine, setRoutine] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [loading, startLoading] = useTransition();
  const [failed, setFailed] = useState(false);

  function load(session: string) {
    setFailed(false);
    startLoading(async () => {
      const result = await readSessionRoutine({ session });
      if (result.state === "read") setRoutine(result.routine);
      else setFailed(true);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle as="h2" className="flex items-center gap-1">
          Rutina
          <InfoTip title="Rutina">
            <p>
              Tu checklist antes de la apertura y al cierre de cada sesión de
              Nueva York, con una nota. Los ítems los escribís vos; quitar uno
              no lo borra de las sesiones que lo tildaron.
            </p>
            <p>Es opcional: no bloquea ni avisa nada.</p>
          </InfoTip>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Sesión anterior"
            disabled={routine.previous === null || loading}
            onClick={() => routine.previous && load(routine.previous)}
          >
            <ChevronLeft />
          </Button>
          <span
            className="numeric min-w-36 text-center text-sm"
            aria-live="polite"
          >
            {loading ? (
              <Spinner className="mx-auto" />
            ) : (
              sessionTitle(routine.session)
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Sesión siguiente"
            disabled={routine.next === null || loading}
            onClick={() => routine.next && load(routine.next)}
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            variant={editing ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            <Pencil data-icon="inline-start" />
            Ítems
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {failed ? (
          <p role="alert" className="text-sm text-muted-foreground">
            No se pudo leer la rutina.
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {(["pre_open", "close"] as const).map((phase) => (
              <PhaseColumn
                // Otra sesión u otra revisión empiezan de lo guardado.
                key={`${routine.session}-${phase}-${routine.phases[phase].revision}-${routine.phases[phase].items.map((item) => item.itemId).join()}`}
                session={routine.session}
                phase={phase}
                reading={routine.phases[phase]}
                editing={editing}
                onSaved={setRoutine}
                onItemsChanged={() => load(routine.session)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
