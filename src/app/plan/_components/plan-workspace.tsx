"use client";

import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";

import { PercentChange } from "@/app/_components/price-change";
import { Segmented } from "@/app/_components/segmented";
import { TickerMark } from "@/app/_components/ticker-mark";

import {
  readLiveAccount,
  readAccountRisk,
  type LiveAccountResult,
  type RiskContextResult,
} from "@/app/cuenta/actions";
import { formatDateTime, formatMoney } from "@/app/_components/trading-format";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { buildFinvizTickersUrl } from "@/modules/finviz-screener/domain/finviz-screener-url";
import type { StoredIdea } from "@/modules/trading/application/pre-market-store";
import {
  ideaLevels,
  purchaseTotal,
} from "@/modules/trading/domain/pre-market-plan";
import {
  markOf,
  openRisk,
  planPosition,
  positionRisk,
} from "@/modules/trading/domain/position-size-risk";
import {
  priceInputSchema,
  quantityInputSchema,
} from "@/modules/trading/domain/trade-annotation";
import type { TradingSetup } from "@/modules/trading/domain/trading-setups";
import { formatAmount } from "@/modules/valuation/domain/display-format";

import { readPlanQuotes, savePreMarketIdea } from "../actions";
import { IdeaRiskSheet } from "./idea-risk-sheet";

type PublicIdea = Omit<StoredIdea, "accountKey">;
type Draft = {
  ideaId: string | null;
  baseRevision: number | null;
  symbol: string;
  setupCode: string | null;
  entry: string;
  quantity: string;
  manualStop: string;
  manualTarget: string;
  stopMode: "manual" | "automatic";
  targetMode: "manual" | "one_to_two" | "one_to_three";
  notes: string;
  status: "active" | "archived";
};
const emptyDraft: Draft = {
  ideaId: null,
  baseRevision: null,
  symbol: "",
  setupCode: null,
  entry: "",
  quantity: "",
  manualStop: "",
  manualTarget: "",
  stopMode: "automatic",
  targetMode: "one_to_two",
  notes: "",
  status: "active",
};
const fmt = (value: string) => formatAmount(value, { scale: 2 });
const formatDayMonth = (instant: string) =>
  new Date(instant).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  });

const FIELD_ERROR: Record<
  string,
  { readonly message: string; readonly field: string | null }
> = {
  symbol: {
    message: "Ingresá un ticker válido, por ejemplo AAPL.",
    field: "symbol",
  },
  setupCode: { message: "Elegí un setup del catálogo.", field: "setupCode" },
  entry: { message: "Ingresá una entrada mayor que cero.", field: "entry" },
  quantity: {
    message: "Ingresá una cantidad entera de acciones mayor que cero.",
    field: "quantity",
  },
  manualStop: {
    message: "Ingresá un stop manual mayor que cero.",
    field: "manualStop",
  },
  manualTarget: {
    message: "Ingresá un target manual mayor que cero.",
    field: "manualTarget",
  },
  notes: {
    message: "Revisá la tesis: admite texto plano de hasta 4.000 caracteres.",
    field: "notes",
  },
  watchlist_limit: {
    message:
      "La watchlist admite hasta 50 símbolos activos para cotizar. Archivá una idea antes de agregar otro.",
    field: null,
  },
  auto_stop_non_positive: {
    message:
      "La cantidad elegida deja el stop automático en cero o menos. Reducí la cantidad o elegí un stop manual.",
    field: "quantity",
  },
  no_equity: {
    message:
      "Schwab no informó un capital positivo. Reintentá cuando la cuenta esté disponible.",
    field: null,
  },
  non_positive_input: {
    message: "Entrada, cantidad, stop y target deben ser positivos.",
    field: "entry",
  },
  baseRevision: {
    message: "El plan cambió en otra pestaña. Recargá antes de editar.",
    field: null,
  },
};

function Field({
  label,
  value,
  onChange,
  hint,
  inputMode = "decimal",
  name,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: React.ReactNode;
  inputMode?: "decimal" | "numeric" | "text";
  name: string;
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        name={name}
        inputMode={inputMode}
        aria-invalid={invalid}
        autoComplete="off"
        value={value}
        className={inputMode === "text" ? undefined : "numeric"}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={
          [hint ? `${id}-hint` : null, invalid ? "plan-field-error" : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {hint ? (
        <span
          id={`${id}-hint`}
          className="numeric text-xs text-muted-foreground"
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function FieldSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  name,
  invalid = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  name: string;
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <NativeSelect
        id={id}
        name={name}
        aria-invalid={invalid}
        aria-describedby={invalid ? "plan-field-error" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function PlanWorkspace({
  ideas,
  setups,
}: {
  ideas: readonly PublicIdea[];
  setups: readonly TradingSetup[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [live, setLive] = useState<LiveAccountResult | null>(null);
  const [risk, setRisk] = useState<RiskContextResult | null>(null);
  const [quotes, setQuotes] = useState<Awaited<
    ReturnType<typeof readPlanQuotes>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [refreshingQuotes, setRefreshingQuotes] = useState(false);
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrorField(null);
    setMessage("");
  };

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      readLiveAccount({}),
      readAccountRisk({ force: false }),
      readPlanQuotes({}),
    ]).then(([account, context, prices]) => {
      if (!mounted) return;
      setLive(account);
      setRisk(context);
      setQuotes(prices);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const equity = live?.state === "read" ? live.balances.liquidationValue : null;
  const settings = risk?.state === "read" ? risk.settings : null;
  const entry = priceInputSchema.safeParse(draft.entry);
  const quantity = quantityInputSchema.safeParse(draft.quantity);
  const wholeQuantity =
    quantity.success &&
    quantity.data !== null &&
    /^[1-9][0-9]*$/u.test(quantity.data);
  const manualStop = priceInputSchema.safeParse(draft.manualStop);
  const manualTarget = priceInputSchema.safeParse(draft.manualTarget);
  const levels =
    equity !== null &&
    settings !== null &&
    entry.success &&
    entry.data !== null &&
    quantity.success &&
    quantity.data !== null &&
    wholeQuantity &&
    manualStop.success &&
    manualTarget.success &&
    (draft.stopMode === "automatic" || manualStop.data !== null) &&
    (draft.targetMode !== "manual" || manualTarget.data !== null)
      ? ideaLevels({
          entry: entry.data,
          quantity: quantity.data,
          manualStop: manualStop.data,
          manualTarget: manualTarget.data,
          stopMode: draft.stopMode,
          targetMode: draft.targetMode,
          liquidationValue: equity,
          riskPercent: settings.riskPerTradePercent,
        })
      : null;
  const plans = new Map(
    risk?.state === "read" ? risk.plans.map((plan) => [plan.symbol, plan]) : [],
  );
  const open =
    live?.state === "read" && risk?.state === "read"
      ? openRisk(
          live.positions
            .filter((position) => position.side !== "flat")
            .map((position) =>
              positionRisk({
                position,
                price: markOf(position),
                plan: plans.get(position.symbol) ?? null,
                orders: live.openOrders,
              }),
            ),
          live.balances.liquidationValue,
          risk.settings.openRiskPercent,
        )
      : null;
  const size =
    levels?.state === "valid" && live?.state === "read" && settings !== null
      ? planPosition({
          liquidationValue: live.balances.liquidationValue,
          buyingPower: live.balances.cashAvailableForTrading,
          openRiskPercent: settings.openRiskPercent,
          riskPerTradePercent: settings.riskPerTradePercent,
          openRisk: open?.value ?? null,
          entry: entry.data!,
          stop: levels.stop,
          target: levels.target,
        })
      : null;
  const bySymbol = new Map(
    quotes?.state === "read"
      ? quotes.quotes.map((quote) => [quote.symbol, quote])
      : [],
  );
  const activeIdeas = ideas.filter((idea) => idea.status === "active");
  const archivedCount = ideas.length - activeIdeas.length;
  const shownIdeas = showArchived ? ideas : activeIdeas;
  const finvizWatchlist = buildFinvizTickersUrl(
    activeIdeas.map((idea) => idea.symbol),
  );

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = await savePreMarketIdea(draft);
      if (result.state === "saved" || result.state === "unchanged") {
        setErrorField(null);
        setMessage(
          result.state === "saved"
            ? "Plan guardado como revisión."
            : "El plan ya estaba guardado.",
        );
        setDraft(emptyDraft);
        router.refresh();
      } else if (result.state === "invalid") {
        const detail =
          result.field === "stop_on_wrong_side"
            ? {
                message: "El stop debe quedar debajo de la entrada.",
                field: draft.stopMode === "manual" ? "manualStop" : "quantity",
              }
            : result.field === "target_on_wrong_side"
              ? {
                  message: "El target debe quedar arriba de la entrada.",
                  field:
                    draft.targetMode === "manual" ? "manualTarget" : "entry",
                }
              : (FIELD_ERROR[result.field] ?? {
                  message: "Revisá los valores del plan.",
                  field: null,
                });
        setMessage(detail.message);
        setErrorField(detail.field);
        if (detail.field !== null)
          requestAnimationFrame(() =>
            document
              .querySelector<
                HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
              >(`[name="${detail.field}"]`)
              ?.focus(),
          );
      } else {
        const copy: Record<string, string> = {
          conflict: "Otra pestaña cambió esta idea. Recargá antes de editar.",
          no_account: "Sin cuenta sincronizada. Abrí el Diario.",
          account_unavailable:
            "No se pudo leer el capital actual de Schwab. Reintentá.",
          unavailable: "No se pudo guardar. Reintentá.",
        };
        setMessage(copy[result.state] ?? "No se pudo guardar.");
      }
    } catch {
      setMessage("No se pudo guardar el plan. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  function edit(idea: PublicIdea) {
    setErrorField(null);
    setDraft({
      ideaId: idea.ideaId,
      baseRevision: idea.revision,
      symbol: idea.symbol,
      setupCode: idea.setupCode,
      entry: idea.entry,
      quantity: idea.quantity,
      manualStop: idea.manualStop ?? "",
      manualTarget: idea.manualTarget ?? "",
      stopMode: idea.stopMode,
      targetMode: idea.targetMode,
      notes: idea.notes,
      status: idea.status,
    });
    setMessage(`Editando ${idea.symbol}.`);
    document
      .getElementById("plan-editor")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /** Archivar o restaurar es una revisión más de la idea, con sus mismos niveles. */
  async function toggleArchived(idea: PublicIdea) {
    setRowBusy(idea.ideaId);
    setMessage("");
    try {
      const result = await savePreMarketIdea({
        ideaId: idea.ideaId,
        baseRevision: idea.revision,
        symbol: idea.symbol,
        setupCode: idea.setupCode,
        entry: idea.entry,
        quantity: idea.quantity,
        manualStop: idea.manualStop ?? "",
        manualTarget: idea.manualTarget ?? "",
        stopMode: idea.stopMode,
        targetMode: idea.targetMode,
        notes: idea.notes,
        status: idea.status === "active" ? "archived" : "active",
      } satisfies Draft);
      if (result.state === "saved" || result.state === "unchanged") {
        if (draft.ideaId === idea.ideaId) setDraft(emptyDraft);
        router.refresh();
      } else {
        setMessage(
          result.state === "invalid" && result.field === "watchlist_limit"
            ? FIELD_ERROR.watchlist_limit!.message
            : result.state === "conflict"
              ? "Otra pestaña cambió esta idea. Recargá."
              : `No se pudo ${idea.status === "active" ? "archivar" : "restaurar"} ${idea.symbol}. Reintentá.`,
        );
      }
    } catch {
      setMessage(`No se pudo actualizar ${idea.symbol}. Reintentá.`);
    } finally {
      setRowBusy(null);
    }
  }

  async function refreshQuotes() {
    setRefreshingQuotes(true);
    try {
      setQuotes(await readPlanQuotes({}));
    } catch {
      setQuotes({ state: "unavailable" });
    } finally {
      setRefreshingQuotes(false);
    }
  }

  const actions = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Guardando…" : "Guardar plan"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDraft(emptyDraft);
            setErrorField(null);
            setMessage("");
          }}
        >
          {draft.ideaId === null ? "Limpiar" : "Cancelar"}
        </Button>
      </div>
      <p role="status" className="min-h-5 text-sm text-muted-foreground">
        {errorField === null ? message : ""}
      </p>
    </div>
  );

  // La compra no depende de la cuenta: entrada × shares, aunque Schwab no responda.
  const purchaseHint =
    entry.success && entry.data !== null && wholeQuantity
      ? `US$ ${fmt(purchaseTotal([{ entry: entry.data, quantity: quantity.data! }]))}`
      : null;
  const valid = levels?.state === "valid" ? levels : null;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card id="plan-editor" className="scroll-mt-20">
        <CardHeader>
          <CardTitle as="h2">
            {draft.ideaId === null ? "Nueva idea" : `Editar ${draft.symbol}`}
          </CardTitle>
          {errorField !== null ? (
            <p
              id="plan-field-error"
              role="alert"
              className="text-sm text-amber-800 dark:text-amber-300"
            >
              {message}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Ticker"
              inputMode="text"
              name="symbol"
              invalid={errorField === "symbol"}
              value={draft.symbol}
              onChange={(value) => change("symbol", value.toUpperCase())}
            />
            <FieldSelect
              label="Setup"
              name="setupCode"
              invalid={errorField === "setupCode"}
              value={draft.setupCode ?? ""}
              options={[
                { value: "", label: "Sin setup" },
                ...setups.map((setup) => ({
                  value: setup.code,
                  label: setup.label,
                })),
              ]}
              onChange={(value) => change("setupCode", value || null)}
            />
            <Field
              label="Entrada, US$"
              name="entry"
              invalid={errorField === "entry"}
              value={draft.entry}
              onChange={(value) => change("entry", value)}
            />
            <Field
              label="Shares"
              inputMode="numeric"
              name="quantity"
              invalid={errorField === "quantity"}
              value={draft.quantity}
              onChange={(value) => change("quantity", value)}
              hint={purchaseHint ?? "Enteras"}
            />
          </div>
          <LevelChoice
            label="Stop"
            name="manualStop"
            mode={draft.stopMode}
            modes={[
              { value: "automatic", label: "Auto" },
              { value: "manual", label: "Manual" },
            ]}
            onMode={(value) => change("stopMode", value)}
            value={draft.manualStop}
            onValue={(value) => change("manualStop", value)}
            invalid={errorField === "manualStop"}
            computed={
              draft.stopMode === "automatic" && valid !== null
                ? `US$ ${fmt(valid.stop)}`
                : null
            }
            computedTone="text-red-700 dark:text-red-400"
          />
          <LevelChoice
            label="Target"
            name="manualTarget"
            mode={draft.targetMode}
            modes={[
              { value: "one_to_two", label: "1:2" },
              { value: "one_to_three", label: "1:3" },
              { value: "manual", label: "Manual" },
            ]}
            onMode={(value) => change("targetMode", value)}
            value={draft.manualTarget}
            onValue={(value) => change("manualTarget", value)}
            invalid={errorField === "manualTarget"}
            computed={
              draft.targetMode !== "manual" && valid !== null
                ? `US$ ${fmt(valid.target)}`
                : null
            }
            computedTone="text-emerald-700 dark:text-emerald-400"
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="idea-notes" className="text-xs font-medium">
              Tesis
            </label>
            <textarea
              id="idea-notes"
              name="notes"
              aria-invalid={errorField === "notes"}
              aria-describedby={
                errorField === "notes" ? "plan-field-error" : undefined
              }
              className="min-h-20 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
              maxLength={4000}
              value={draft.notes}
              onChange={(event) => change("notes", event.target.value)}
            />
          </div>
          <div className="hidden lg:block">{actions}</div>
        </CardContent>
      </Card>
      <div className="flex min-w-0 flex-col gap-6">
        <IdeaRiskSheet
          live={live}
          risk={risk}
          open={open}
          levels={levels}
          size={size}
          quantity={quantity.success ? quantity.data : null}
          wholeQuantity={wholeQuantity}
          entry={entry.success ? entry.data : null}
          stopMode={draft.stopMode}
          targetMode={draft.targetMode}
          onUseSuggested={(shares) => change("quantity", shares)}
        />
        <div className="lg:hidden">{actions}</div>
        <Watchlist
          ideas={shownIdeas}
          activeIdeas={activeIdeas}
          archivedCount={archivedCount}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((shown) => !shown)}
          setups={setups}
          bySymbol={bySymbol}
          quotes={quotes}
          refreshingQuotes={refreshingQuotes}
          onRefreshQuotes={() => void refreshQuotes()}
          finvizWatchlist={finvizWatchlist}
          editingId={draft.ideaId}
          rowBusy={rowBusy}
          onEdit={edit}
          onToggleIdea={(idea) => void toggleArchived(idea)}
        />
      </div>
    </div>
  );
}

/**
 * Stop o target: el modo como selector y, sólo en manual, el precio. En los
 * modos calculados se ve el nivel que sale, sin otro campo que confunda.
 */
function LevelChoice<T extends string>({
  label,
  name,
  mode,
  modes,
  onMode,
  value,
  onValue,
  invalid,
  computed,
  computedTone,
}: {
  readonly label: string;
  readonly name: string;
  readonly mode: T;
  readonly modes: readonly { value: T; label: string }[];
  readonly onMode: (value: T) => void;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly invalid: boolean;
  readonly computed: string | null;
  readonly computedTone: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <Segmented
          label={`Modo del ${label.toLowerCase()}`}
          options={modes}
          value={mode}
          onChange={onMode}
        />
      </div>
      {mode === "manual" ? (
        <>
          <label htmlFor={id} className="sr-only">
            {label} manual, US$
          </label>
          <Input
            id={id}
            name={name}
            inputMode="decimal"
            autoComplete="off"
            placeholder="US$"
            aria-invalid={invalid}
            aria-describedby={invalid ? "plan-field-error" : undefined}
            className="numeric"
            value={value}
            onChange={(event) => onValue(event.target.value)}
          />
        </>
      ) : (
        <p
          className={cn(
            "numeric flex h-8 items-center rounded-lg bg-muted/60 px-2.5 text-sm",
            computed === null
              ? "text-muted-foreground"
              : cn("font-medium", computedTone),
          )}
        >
          {computed ?? "—"}
        </p>
      )}
    </div>
  );
}

function Watchlist({
  ideas,
  activeIdeas,
  archivedCount,
  showArchived,
  onToggleArchived,
  setups,
  bySymbol,
  quotes,
  refreshingQuotes,
  onRefreshQuotes,
  finvizWatchlist,
  editingId,
  rowBusy,
  onEdit,
  onToggleIdea,
}: {
  readonly ideas: readonly PublicIdea[];
  readonly activeIdeas: readonly PublicIdea[];
  readonly archivedCount: number;
  readonly showArchived: boolean;
  readonly onToggleArchived: () => void;
  readonly setups: readonly TradingSetup[];
  readonly bySymbol: ReadonlyMap<
    string,
    { readonly lastPrice: string; readonly netPercentChange?: string | null }
  >;
  readonly quotes: Awaited<ReturnType<typeof readPlanQuotes>> | null;
  readonly refreshingQuotes: boolean;
  readonly onRefreshQuotes: () => void;
  readonly finvizWatchlist: string | null;
  readonly editingId: string | null;
  readonly rowBusy: string | null;
  readonly onEdit: (idea: PublicIdea) => void;
  readonly onToggleIdea: (idea: PublicIdea) => void;
}) {
  const quoteStatus =
    quotes === null
      ? null
      : quotes.state === "read"
        ? `${new Date(quotes.readAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}${quotes.invalidSymbols.length ? ` · ${quotes.invalidSymbols.length} sin cotizar` : ""}`
        : quotes.state === "limit_reached"
          ? "Más de 50 activas: sin cotizar"
          : "Sin cotización";

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b">
        <div className="flex flex-col">
          <CardTitle as="h2">Watchlist</CardTitle>
          <span className="numeric text-xs text-muted-foreground">
            {activeIdeas.length} activas
            {activeIdeas.length === 0
              ? ""
              : ` · US$ ${formatMoney(purchaseTotal(activeIdeas))}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {archivedCount === 0 ? null : (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={showArchived}
              onClick={onToggleArchived}
            >
              {showArchived ? (
                <EyeOff data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Eye data-icon="inline-start" aria-hidden="true" />
              )}
              Archivadas
              <span className="numeric text-muted-foreground">
                {archivedCount}
              </span>
            </Button>
          )}
          {finvizWatchlist === null ? null : (
            <a
              href={finvizWatchlist}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
            >
              Finviz
              <ExternalLink data-icon="inline-end" aria-hidden="true" />
              <span className="sr-only"> (pestaña nueva)</span>
            </a>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onRefreshQuotes}
            disabled={refreshingQuotes}
          >
            <RefreshCw
              data-icon="inline-start"
              aria-hidden="true"
              className={
                refreshingQuotes ? "motion-safe:animate-spin" : undefined
              }
            />
            <span className="numeric">{quoteStatus ?? "Cotizar"}</span>
          </Button>
        </div>
      </CardHeader>
      {ideas.length === 0 ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {archivedCount === 0 ? "Sin ideas." : "Sin ideas activas."}
          </p>
        </CardContent>
      ) : (
        <CardContent className="px-0">
          {/* `relative`: los `sr-only` de la última columna se recortan acá. */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <caption className="sr-only">
                Ideas de la watchlist. La compra es entrada por cantidad.
              </caption>
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Ticker
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Última
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Entrada
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Stop
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Target
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Shares
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Compra
                  </th>
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ideas.map((idea) => {
                  const result = ideaLevels(idea);
                  const quote =
                    idea.status === "active" ? bySymbol.get(idea.symbol) : null;
                  const archived = idea.status === "archived";
                  const setup =
                    setups.find(
                      (candidate) => candidate.code === idea.setupCode,
                    )?.label ?? null;
                  return (
                    <tr
                      key={idea.ideaId}
                      data-archived={archived || undefined}
                      className={cn(
                        "border-b last:border-b-0 hover:bg-muted/40",
                        archived && "text-muted-foreground",
                        editingId === idea.ideaId && "bg-accent/50",
                      )}
                    >
                      <th scope="row" className="px-4 py-2 font-normal">
                        <span className="flex items-center gap-2">
                          <TickerMark
                            ticker={idea.symbol}
                            className={
                              archived ? "opacity-50 grayscale" : undefined
                            }
                          />
                          <span className="flex flex-col">
                            <span className="font-semibold">
                              {idea.symbol}
                              {archived ? (
                                <span className="sr-only"> (archivada)</span>
                              ) : null}
                            </span>
                            <span className="numeric text-xs whitespace-nowrap text-muted-foreground">
                              {setup === null ? "" : `${setup} · `}
                              <time
                                dateTime={idea.recordedAt}
                                title={formatDateTime(idea.recordedAt)}
                              >
                                {formatDayMonth(idea.recordedAt)}
                              </time>
                            </span>
                          </span>
                        </span>
                      </th>
                      <td className="numeric px-3 py-2 text-right whitespace-nowrap">
                        {quote ? (
                          <span className="flex flex-col items-end">
                            {fmt(quote.lastPrice)}
                            <PercentChange
                              value={quote.netPercentChange}
                              className="text-xs"
                            />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="numeric px-3 py-2 text-right whitespace-nowrap">
                        {fmt(idea.entry)}
                      </td>
                      <td
                        className={cn(
                          "numeric px-3 py-2 text-right whitespace-nowrap",
                          !archived && "text-red-700 dark:text-red-400",
                        )}
                      >
                        {result.state === "valid" ? fmt(result.stop) : "—"}
                      </td>
                      <td
                        className={cn(
                          "numeric px-3 py-2 text-right whitespace-nowrap",
                          !archived && "text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {result.state === "valid" ? fmt(result.target) : "—"}
                      </td>
                      <td className="numeric px-3 py-2 text-right whitespace-nowrap">
                        {idea.quantity}
                      </td>
                      <td className="numeric px-3 py-2 text-right font-semibold whitespace-nowrap">
                        {result.state === "valid"
                          ? `US$ ${fmt(result.chosenValue)}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span className="flex justify-end gap-1">
                          {archived ? null : (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Editar ${idea.symbol}`}
                              onClick={() => onEdit(idea)}
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${archived ? "Restaurar" : "Archivar"} ${idea.symbol}`}
                            title={archived ? "Restaurar" : "Archivar"}
                            disabled={rowBusy !== null}
                            onClick={() => onToggleIdea(idea)}
                          >
                            {archived ? (
                              <ArchiveRestore aria-hidden="true" />
                            ) : (
                              <Archive aria-hidden="true" />
                            )}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
