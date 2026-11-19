"use client";

import {
  Archive,
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Search,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { InfoTip } from "@/app/_components/info-tip";
import {
  tabBaselineClass,
  tabClass,
  tabListClass,
} from "@/app/_components/tab-styles";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import {
  FINVIZ_DEFAULT_VIEW,
  FINVIZ_FILTERS,
  FINVIZ_SIGNALS,
  FINVIZ_TAB_LABELS,
  FINVIZ_VIEWS,
  finvizFilter,
  finvizOptionLabel,
  type FinvizSignal,
  type FinvizViewCode,
} from "@/modules/finviz-screener/domain/finviz-screener-catalog";
import {
  FINVIZ_FILTER_TABS,
  type FinvizFilter,
  type FinvizFilterTab,
} from "@/modules/finviz-screener/domain/finviz-screener-page";
import {
  FINVIZ_STRATEGY_NAME_MAX,
  strategySelection,
  type StoredFinvizStrategy,
} from "@/modules/finviz-screener/domain/finviz-screener-strategy";
import {
  buildFinvizScreenerUrl,
  EMPTY_FINVIZ_SELECTION,
  readFinvizScreenerLink,
  type FinvizDroppedToken,
  type FinvizSelection,
} from "@/modules/finviz-screener/domain/finviz-screener-url";

import { archiveFinvizStrategy, saveFinvizStrategy } from "../actions";

export type StrategiesState =
  | { readonly state: "ready"; readonly strategies: StoredFinvizStrategy[] }
  | { readonly state: "disabled" }
  | { readonly state: "unavailable"; readonly reference: string };

type Editing = {
  readonly strategyId: string;
  readonly revision: number;
  readonly name: string;
};

const activeSelectClass =
  "border-primary bg-accent font-medium dark:bg-accent/40";

const DROPPED_REASONS: Readonly<Record<FinvizDroppedToken["reason"], string>> =
  {
    unknown_filter: "variable que el catálogo no tiene",
    unknown_option: "opción Elite o que Finviz ya no ofrece",
    multiple_values: "varios valores juntos (Elite)",
    repeated_filter: "variable repetida",
    unknown_signal: "señal Elite o desconocida",
    unknown_view: `vista desconocida; queda ${FINVIZ_VIEWS.find((view) => view.code === FINVIZ_DEFAULT_VIEW)?.label ?? FINVIZ_DEFAULT_VIEW}`,
  };

const SAVE_MESSAGES: Readonly<Record<string, string>> = {
  conflict: "Otra pestaña cambió esta estrategia. Recargá y volvé a guardar.",
  name_taken: "Ya hay una estrategia activa con ese nombre.",
  invalid: "Revisá el nombre: entre 1 y 80 caracteres.",
  unavailable: "La base de trading no respondió; la estrategia no se guardó.",
};

function normalized(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matches(filter: FinvizFilter, query: string): boolean {
  const needle = normalized(query.trim());
  if (needle === "") return true;
  return [filter.label, filter.title, filter.key].some((text) =>
    normalized(text).includes(needle),
  );
}

/** Opciones sueltas primero; las agrupadas, en el orden en que Finviz las da. */
function optionGroups(filter: FinvizFilter) {
  const loose = filter.options.filter((option) => option.group === null);
  const groups = new Map<string, typeof filter.options>();
  for (const option of filter.options) {
    if (option.group === null) continue;
    groups.set(option.group, [...(groups.get(option.group) ?? []), option]);
  }
  return { loose, groups: [...groups.entries()] };
}

function selectionFromLocation(): FinvizSelection | null {
  if (typeof window === "undefined" || window.location.search === "")
    return null;
  const reading = readFinvizScreenerLink(
    `https://finviz.com/screener/stocks${window.location.search}`,
  );
  return reading.state === "read" ? reading.selection : null;
}

function locationQuery(selection: FinvizSelection): string {
  const url = buildFinvizScreenerUrl(selection);
  return url.slice(url.indexOf("?"));
}

function FilterField({
  filter,
  value,
  onChange,
}: {
  readonly filter: FinvizFilter;
  readonly value: string | undefined;
  readonly onChange: (value: string | null) => void;
}) {
  const id = useId();
  const { loose, groups } = optionGroups(filter);
  const active = value !== undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-6 items-center gap-1">
        <label
          htmlFor={id}
          className={cn(
            "truncate text-xs",
            active ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {filter.label}
        </label>
        {filter.description === "" ? null : (
          <InfoTip title={filter.title}>
            <p>{filter.description}</p>
            <p>
              <code className="font-mono text-xs">{filter.key}_…</code>
            </p>
          </InfoTip>
        )}
      </div>
      <NativeSelect
        id={id}
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : event.target.value)
        }
        className={cn(active && activeSelectClass)}
      >
        <option value="">Any</option>
        {loose.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {groups.map(([group, options]) => (
          <optgroup key={group} label={group}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </NativeSelect>
    </div>
  );
}

function SelectionChips({
  selection,
  onRemove,
  onClearSignal,
}: {
  readonly selection: FinvizSelection;
  readonly onRemove: (key: string) => void;
  readonly onClearSignal: () => void;
}) {
  const filters = FINVIZ_FILTERS.filter(
    (filter) => filter.key in selection.filters,
  );
  const signal = FINVIZ_SIGNALS.find(
    (candidate) => candidate.value === selection.signal,
  );
  if (filters.length === 0 && signal === undefined)
    return (
      <p className="text-sm text-muted-foreground">
        Sin filtros: todo el mercado.
      </p>
    );
  const chip =
    "inline-flex max-w-full items-center gap-1 rounded-md border bg-background py-0.5 pr-0.5 pl-2 text-xs";
  const remove =
    "inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Filtros elegidos">
      {signal === undefined ? null : (
        <li className={cn(chip, "border-primary/40")}>
          <span className="truncate">
            <span className="text-muted-foreground">Signal </span>
            {signal.label}
          </span>
          <button
            type="button"
            className={remove}
            aria-label={`Quitar la señal ${signal.label}`}
            onClick={onClearSignal}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </li>
      )}
      {filters.map((filter) => {
        const label = finvizOptionLabel(
          filter.key,
          selection.filters[filter.key]!,
        );
        return (
          <li key={filter.key} className={chip}>
            <span className="truncate">
              <span className="text-muted-foreground">{filter.label} </span>
              {label}
            </span>
            <button
              type="button"
              className={remove}
              aria-label={`Quitar ${filter.label}: ${label}`}
              onClick={() => onRemove(filter.key)}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DroppedList({
  dropped,
}: {
  readonly dropped: readonly FinvizDroppedToken[];
}) {
  if (dropped.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {dropped.map((item) => (
        <li key={item.token} className="flex flex-wrap gap-x-1.5">
          <code className="font-mono text-foreground">{item.token}</code>
          <span>{DROPPED_REASONS[item.reason]}</span>
        </li>
      ))}
    </ul>
  );
}

export function FinvizBuilder({
  strategies,
}: {
  readonly strategies: StrategiesState;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState<FinvizSelection>(
    EMPTY_FINVIZ_SELECTION,
  );
  const [tab, setTab] = useState<FinvizFilterTab>("descriptive");
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [dropped, setDropped] = useState<readonly FinvizDroppedToken[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const loaded = useRef(false);
  const tabRefs = useRef<Partial<Record<FinvizFilterTab, HTMLButtonElement>>>(
    {},
  );

  useEffect(() => {
    const initial = selectionFromLocation();
    // La selección vive en la URL de la página: recargar no la pierde.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee una vez de la URL al montar.
    if (initial !== null) setSelection(initial);
  }, []);

  useEffect(() => {
    // El primer commit trae la selección vacía; la de la URL llega después.
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${locationQuery(selection)}`,
    );
  }, [selection]);

  const url = useMemo(() => buildFinvizScreenerUrl(selection), [selection]);
  const counts = useMemo(() => {
    const result: Record<FinvizFilterTab, number> = {
      descriptive: 0,
      fundamental: 0,
      technical: 0,
      news: 0,
    };
    for (const key of Object.keys(selection.filters)) {
      const filter = finvizFilter(key);
      if (filter !== undefined) result[filter.tab] += 1;
    }
    return result;
  }, [selection.filters]);
  const searching = query.trim() !== "";
  const visible = FINVIZ_FILTERS.filter((filter) =>
    searching ? matches(filter, query) : filter.tab === tab,
  );
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  function change(next: Partial<FinvizSelection>) {
    setSelection((current) => ({ ...current, ...next }));
    setCopied(false);
    setMessage("");
  }

  function setFilter(key: string, value: string | null) {
    setSelection((current) => {
      const filters = { ...current.filters };
      if (value === null) delete filters[key];
      else filters[key] = value;
      return { ...current, filters };
    });
    setCopied(false);
    setMessage("");
  }

  function reset() {
    setSelection(EMPTY_FINVIZ_SELECTION);
    setEditing(null);
    setName("");
    setDropped([]);
    setMessage("");
  }

  function importLink() {
    const reading = readFinvizScreenerLink(paste);
    if (reading.state === "rejected") {
      setImportMessage(
        reading.reason === "not_screener"
          ? "Ese link de Finviz no es del screener."
          : "Pegá un link https://finviz.com/screener…",
      );
      return;
    }
    setSelection(reading.selection);
    setDropped(reading.dropped);
    setPaste("");
    setImportMessage(
      reading.dropped.length === 0
        ? "Link importado completo."
        : `Link importado; ${reading.dropped.length} parte${reading.dropped.length === 1 ? "" : "s"} fuera del catálogo.`,
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setMessage("El navegador no dejó copiar; usá «Abrir en Finviz».");
    }
  }

  async function save(asNew: boolean) {
    setBusy(true);
    setMessage("");
    const target = asNew ? null : editing;
    const result = await saveFinvizStrategy({
      strategyId: target?.strategyId ?? null,
      baseRevision: target?.revision ?? null,
      name,
      view: selection.view,
      signal: selection.signal,
      filters: selection.filters,
    });
    setBusy(false);
    if (result.state === "saved" || result.state === "unchanged") {
      setEditing({
        strategyId: result.strategyId,
        revision: result.revision,
        name: name.replace(/\s+/g, " ").trim(),
      });
      setMessage(
        result.state === "saved"
          ? `Guardada · v${result.revision}`
          : "Sin cambios",
      );
      router.refresh();
      return;
    }
    setMessage(SAVE_MESSAGES[result.state] ?? SAVE_MESSAGES.unavailable!);
  }

  function load(strategy: StoredFinvizStrategy) {
    const read = strategySelection(strategy);
    setSelection(read.selection);
    setDropped(read.dropped);
    setEditing({
      strategyId: strategy.strategyId,
      revision: strategy.revision,
      name: strategy.name,
    });
    setName(strategy.name);
    setMessage("");
    setImportMessage("");
  }

  async function archive(strategy: StoredFinvizStrategy) {
    const result = await archiveFinvizStrategy({
      strategyId: strategy.strategyId,
      baseRevision: strategy.revision,
    });
    if (result === "archived") {
      if (editing?.strategyId === strategy.strategyId) setEditing(null);
      router.refresh();
    } else {
      setMessage(
        result === "conflict"
          ? SAVE_MESSAGES.conflict!
          : SAVE_MESSAGES.unavailable!,
      );
    }
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = FINVIZ_FILTER_TABS.indexOf(tab);
    const count = FINVIZ_FILTER_TABS.length;
    // Flechas recorren en ronda; Inicio y Fin saltan a los extremos (APG).
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % count
        : event.key === "ArrowLeft"
          ? (index - 1 + count) % count
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? count - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = FINVIZ_FILTER_TABS[target]!;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const signalGroups = [...new Set(FINVIZ_SIGNALS.map((s) => s.group))];
  const canSave =
    strategies.state === "ready" &&
    name.trim() !== "" &&
    name.length <= FINVIZ_STRATEGY_NAME_MAX;

  return (
    <div className="grid gap-6 pb-20 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
      <section aria-labelledby="finviz-filters" className="min-w-0">
        <h2 id="finviz-filters" className="sr-only">
          Filtros
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="finviz-view" className="text-xs font-medium">
              Vista
            </label>
            <NativeSelect
              id="finviz-view"
              value={selection.view}
              onChange={(event) =>
                change({ view: event.target.value as FinvizViewCode })
              }
            >
              {FINVIZ_VIEWS.map((view) => (
                <option key={view.code} value={view.code}>
                  {view.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="finviz-signal" className="text-xs font-medium">
              Signal
            </label>
            <NativeSelect
              id="finviz-signal"
              className={cn(selection.signal !== null && activeSelectClass)}
              value={selection.signal ?? ""}
              onChange={(event) =>
                change({
                  signal:
                    event.target.value === ""
                      ? null
                      : (event.target.value as FinvizSignal),
                })
              }
            >
              <option value="">None</option>
              {signalGroups.map((group) => (
                <optgroup key={group} label={group}>
                  {FINVIZ_SIGNALS.filter((s) => s.group === group).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="finviz-search" className="text-xs font-medium">
              Buscar variable
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="finviz-search"
                type="search"
                className="pl-8"
                placeholder="P/E, RSI, Float…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-2">
          {searching ? (
            <p role="status" className="py-2 text-sm text-muted-foreground">
              {visible.length} de {FINVIZ_FILTERS.length} variables
            </p>
          ) : (
            <div
              role="tablist"
              aria-label="Grupos de variables"
              className={cn(tabListClass, tabBaselineClass, "min-w-0 flex-1")}
            >
              {FINVIZ_FILTER_TABS.map((key) => (
                <button
                  key={key}
                  ref={(node) => {
                    if (node !== null) tabRefs.current[key] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`finviz-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls="finviz-panel"
                  tabIndex={tab === key ? 0 : -1}
                  onClick={() => setTab(key)}
                  onKeyDown={onTabKey}
                  className={tabClass(tab === key)}
                >
                  {FINVIZ_TAB_LABELS[key]}
                  {counts[key] > 0 ? (
                    <span className="numeric inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                      {counts[key]}
                      <span className="sr-only"> elegidas</span>
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={
              total === 0 && selection.signal === null && editing === null
            }
          >
            Limpiar todo
          </Button>
        </div>

        <div
          id="finviz-panel"
          role={searching ? undefined : "tabpanel"}
          aria-labelledby={searching ? undefined : `finviz-tab-${tab}`}
          className="mt-3 grid gap-x-4 gap-y-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
              Ninguna variable se llama así.
            </p>
          ) : (
            visible.map((filter) => (
              <FilterField
                key={filter.key}
                filter={filter}
                value={selection.filters[filter.key]}
                onChange={(value) => setFilter(filter.key, value)}
              />
            ))
          )}
        </div>
      </section>

      <aside
        aria-label="Pantalla de Finviz"
        className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start"
      >
        <section
          aria-labelledby="finviz-screen-title"
          className="flex flex-col gap-3 rounded-xl border bg-card p-4"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="finviz-screen-title" className="text-base font-semibold">
              {editing?.name ?? "Pantalla"}
            </h2>
            <span className="numeric text-xs text-muted-foreground">
              {total} {total === 1 ? "filtro" : "filtros"} ·{" "}
              {FINVIZ_VIEWS.find((view) => view.code === selection.view)?.label}
            </span>
          </div>
          <SelectionChips
            selection={selection}
            onRemove={(key) => setFilter(key, null)}
            onClearSignal={() => change({ signal: null })}
          />
          <div className="flex flex-wrap gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className={cn(buttonVariants(), "gap-1.5")}
            >
              Abrir en Finviz
              <ExternalLink aria-hidden="true" className="size-4" />
              <span className="sr-only"> (pestaña nueva)</span>
            </a>
            <Button variant="outline" onClick={() => void copy()}>
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
              {copied ? "Copiado" : "Copiar link"}
            </Button>
          </div>
          <code className="block max-h-20 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-muted-foreground">
            {url}
          </code>
          <DroppedList dropped={dropped} />

          {strategies.state === "ready" ? (
            <form
              className="flex flex-col gap-2 border-t pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save(false);
              }}
            >
              <label htmlFor="finviz-name" className="text-xs font-medium">
                Nombre de la estrategia
              </label>
              <Input
                id="finviz-name"
                value={name}
                maxLength={FINVIZ_STRATEGY_NAME_MAX}
                placeholder="Breakouts con volumen"
                onChange={(event) => {
                  setName(event.target.value);
                  setMessage("");
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!canSave || busy}>
                  {busy
                    ? "Guardando…"
                    : editing === null
                      ? "Guardar estrategia"
                      : "Guardar cambios"}
                </Button>
                {editing === null ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canSave || busy}
                    onClick={() => void save(true)}
                  >
                    Guardar como nueva
                  </Button>
                )}
              </div>
            </form>
          ) : null}
          <p role="status" className="min-h-4 text-xs text-muted-foreground">
            {message}
          </p>
        </section>

        <section
          aria-labelledby="finviz-import-title"
          className="flex flex-col gap-2 rounded-xl border bg-card p-4"
        >
          <h2 id="finviz-import-title" className="text-sm font-semibold">
            Importar de Finviz
          </h2>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              importLink();
            }}
          >
            <label htmlFor="finviz-paste" className="sr-only">
              Link del screener de Finviz
            </label>
            <Input
              id="finviz-paste"
              inputMode="url"
              placeholder="https://finviz.com/screener…"
              value={paste}
              onChange={(event) => {
                setPaste(event.target.value);
                setImportMessage("");
              }}
            />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              aria-label="Importar link"
              disabled={paste.trim() === ""}
            >
              <ClipboardPaste aria-hidden="true" className="size-4" />
            </Button>
          </form>
          <p role="status" className="min-h-4 text-xs text-muted-foreground">
            {importMessage}
          </p>
        </section>

        <StrategyList
          strategies={strategies}
          editingId={editing?.strategyId ?? null}
          onLoad={load}
          onArchive={(strategy) => void archive(strategy)}
        />
      </aside>

      {/* En el teléfono la pantalla queda debajo de los filtros: la acción
          principal acompaña al owner mientras elige. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur-sm lg:hidden">
        <a
          href="#finviz-screen-title"
          className="numeric min-w-0 truncate text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          {total} {total === 1 ? "filtro" : "filtros"}
          {selection.signal === null ? "" : " + signal"}
        </a>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className={cn(buttonVariants(), "shrink-0 gap-1.5")}
        >
          Abrir en Finviz
          <ExternalLink aria-hidden="true" className="size-4" />
          <span className="sr-only"> (pestaña nueva)</span>
        </a>
      </div>
    </div>
  );
}

function StrategyList({
  strategies,
  editingId,
  onLoad,
  onArchive,
}: {
  readonly strategies: StrategiesState;
  readonly editingId: string | null;
  readonly onLoad: (strategy: StoredFinvizStrategy) => void;
  readonly onArchive: (strategy: StoredFinvizStrategy) => void;
}) {
  return (
    <section
      aria-labelledby="finviz-strategies-title"
      className="flex flex-col gap-2 rounded-xl border bg-card p-4"
    >
      <h2 id="finviz-strategies-title" className="text-sm font-semibold">
        Estrategias
      </h2>
      {strategies.state === "disabled" ? (
        <p className="text-sm text-muted-foreground">
          Configurá{" "}
          <code className="font-mono text-xs">TRADING_DATABASE_URL</code> para
          guardarlas.
        </p>
      ) : strategies.state === "unavailable" ? (
        <p className="text-sm text-muted-foreground">
          La base de trading no respondió. Referencia{" "}
          <code className="font-mono text-xs">{strategies.reference}</code>.
        </p>
      ) : strategies.strategies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Armá una pantalla y guardala con un nombre.
        </p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {strategies.strategies.map((strategy) => {
            const read = strategySelection(strategy);
            const count = Object.keys(read.selection.filters).length;
            const signal = FINVIZ_SIGNALS.find(
              (candidate) => candidate.value === strategy.signal,
            );
            return (
              <li
                key={strategy.strategyId}
                className={cn(
                  "flex items-center gap-1 rounded-md px-1 py-1",
                  editingId === strategy.strategyId && "bg-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => onLoad(strategy)}
                  className="flex min-w-0 flex-1 flex-col items-start rounded-sm px-1 text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label={`Cargar ${strategy.name} en el armador`}
                >
                  <span className="max-w-full truncate text-sm font-medium">
                    {strategy.name}
                  </span>
                  <span className="numeric text-xs text-muted-foreground">
                    {count} {count === 1 ? "filtro" : "filtros"}
                    {signal === undefined ? "" : ` · ${signal.label}`}
                    {read.dropped.length > 0
                      ? ` · ${read.dropped.length} fuera del catálogo`
                      : ""}
                  </span>
                </button>
                <a
                  href={buildFinvizScreenerUrl(read.selection)}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  aria-label={`Abrir ${strategy.name} en Finviz (pestaña nueva)`}
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Archivar ${strategy.name}`}
                  onClick={() => onArchive(strategy)}
                >
                  <Archive aria-hidden="true" className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
