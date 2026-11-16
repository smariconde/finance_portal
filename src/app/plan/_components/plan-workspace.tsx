"use client";

import { TickerMark } from "@/app/_components/ticker-mark";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";

import {
  readLiveAccount,
  readAccountRisk,
  type LiveAccountResult,
  type RiskContextResult,
} from "@/app/cuenta/actions";
import { formatDateTime, formatMoney } from "@/app/_components/trading-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const fmt = (value: string) => formatAmount(value, { scale: 2 });

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
  hint?: string;
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
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={
          [hint ? `${id}-hint` : null, invalid ? "plan-field-error" : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
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
      <select
        id={id}
        name={name}
        aria-invalid={invalid}
        aria-describedby={invalid ? "plan-field-error" : undefined}
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PlanWorkspace({
  ideas,
  setups,
  lastFour,
}: {
  ideas: readonly PublicIdea[];
  setups: readonly TradingSetup[];
  lastFour: string;
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
    setMessage(`Editando ${idea.symbol}, revisión ${idea.revision}.`);
    document
      .getElementById("plan-editor")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-muted-foreground">
        Cuenta ···{lastFour} · Largos de acciones y ETF
      </p>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card id="plan-editor">
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
                label="Cantidad elegida"
                inputMode="numeric"
                name="quantity"
                invalid={errorField === "quantity"}
                value={draft.quantity}
                onChange={(value) => change("quantity", value)}
                hint="Acciones enteras"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldSelect
                label="Stop"
                name="stopMode"
                invalid={errorField === "stopMode"}
                value={draft.stopMode}
                options={[
                  { value: "manual", label: "Manual" },
                  { value: "automatic", label: "Automático" },
                ]}
                onChange={(value) => change("stopMode", value)}
              />
              <Field
                label="Stop manual, US$"
                name="manualStop"
                invalid={errorField === "manualStop"}
                value={draft.manualStop}
                onChange={(value) => change("manualStop", value)}
                hint={
                  draft.stopMode === "manual"
                    ? "Obligatorio"
                    : "Alternativa opcional"
                }
              />
              <FieldSelect
                label="Target"
                name="targetMode"
                invalid={errorField === "targetMode"}
                value={draft.targetMode}
                options={[
                  { value: "one_to_two", label: "1:2" },
                  { value: "one_to_three", label: "1:3" },
                  { value: "manual", label: "Manual" },
                ]}
                onChange={(value) => change("targetMode", value)}
              />
              <Field
                label="Target manual, US$"
                name="manualTarget"
                invalid={errorField === "manualTarget"}
                value={draft.manualTarget}
                onChange={(value) => change("manualTarget", value)}
                hint={
                  draft.targetMode === "manual"
                    ? "Obligatorio"
                    : "Alternativa opcional"
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="idea-notes" className="text-xs font-medium">
                Tesis breve
              </label>
              <textarea
                id="idea-notes"
                name="notes"
                aria-invalid={errorField === "notes"}
                aria-describedby={
                  errorField === "notes" ? "plan-field-error" : undefined
                }
                className="min-h-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                maxLength={4000}
                value={draft.notes}
                onChange={(event) => change("notes", event.target.value)}
              />
            </div>
            {draft.ideaId !== null ? (
              <FieldSelect
                label="Estado"
                name="status"
                invalid={errorField === "status"}
                value={draft.status}
                options={[
                  { value: "active", label: "Activa" },
                  { value: "archived", label: "Archivada" },
                ]}
                onChange={(value) => change("status", value)}
              />
            ) : null}
            <div className="hidden flex-wrap gap-2 lg:flex">
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? "Guardando…" : "Guardar plan"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(emptyDraft);
                  setMessage("");
                }}
              >
                Limpiar
              </Button>
            </div>
            <p
              role="status"
              className="hidden text-sm text-muted-foreground lg:block"
            >
              {message}
            </p>
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
          />
          <div className="flex flex-col gap-2 lg:hidden">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={busy}>
                {busy ? "Guardando…" : "Guardar plan"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(emptyDraft);
                  setMessage("");
                }}
              >
                Limpiar
              </Button>
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          </div>
        </div>
      </div>
      <section aria-labelledby="watchlist-title" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="watchlist-title" className="text-lg font-semibold">
              Watchlist
            </h2>
            <p className="text-xs text-muted-foreground">
              {activeIdeas.length} activas · compra{" "}
              {activeIdeas.length === 0
                ? "—"
                : `US$ ${formatMoney(purchaseTotal(activeIdeas))}`}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void readPlanQuotes({}).then(setQuotes)}
          >
            Actualizar cotizaciones
          </Button>
        </div>
        {ideas.length === 0 ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            Todavía no hay ideas. Guardá la primera antes de la rueda.
          </div>
        ) : (
          <div>
            <p className="mb-2 text-xs text-muted-foreground md:hidden">
              Deslizá la tabla para ver niveles y fecha del plan.
            </p>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[780px] text-left text-sm">
                <caption className="sr-only">
                  Ideas de la watchlist. La compra es entrada por cantidad con
                  el capital que la revisión observó al guardarse.
                </caption>
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Ticker
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Setup
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Última
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Entrada
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Stop
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Target
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Cantidad
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Compra
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Plan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ideas.map((idea) => {
                    const result = ideaLevels(idea);
                    const quote = bySymbol.get(idea.symbol);
                    return (
                      <tr
                        key={idea.ideaId}
                        className="border-b last:border-b-0"
                      >
                        <th scope="row" className="px-3 py-2 font-semibold">
                          <button
                            className="inline-flex items-center gap-2 text-left underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            aria-label={`Editar idea ${idea.symbol}, entrada ${idea.entry}, revisión ${idea.revision}, identificador ${idea.ideaId.slice(0, 8)}`}
                            onClick={() => edit(idea)}
                          >
                            <TickerMark ticker={idea.symbol} />
                            {idea.symbol}
                          </button>
                          {idea.status === "archived" ? (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              archivada
                            </span>
                          ) : null}
                        </th>
                        <td className="px-3 py-2">
                          {setups.find((setup) => setup.code === idea.setupCode)
                            ?.label ?? "—"}
                        </td>
                        <td className="numeric whitespace-nowrap px-3 py-2 text-right">
                          {quote ? `US$ ${fmt(quote.lastPrice)}` : "—"}
                        </td>
                        <td className="numeric whitespace-nowrap px-3 py-2 text-right">
                          {fmt(idea.entry)}
                        </td>
                        <td className="numeric whitespace-nowrap px-3 py-2 text-right">
                          {result.state === "valid" ? fmt(result.stop) : "—"}
                        </td>
                        <td className="numeric whitespace-nowrap px-3 py-2 text-right">
                          {result.state === "valid" ? fmt(result.target) : "—"}
                        </td>
                        <td className="numeric whitespace-nowrap px-3 py-2 text-right">
                          {idea.quantity}
                        </td>
                        <td className="numeric whitespace-nowrap px-3 py-2 text-right font-semibold">
                          {result.state === "valid"
                            ? `US$ ${fmt(result.chosenValue)}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          <time dateTime={idea.recordedAt}>
                            {formatDateTime(idea.recordedAt)}
                          </time>{" "}
                          · v{idea.revision} · {idea.ideaId.slice(0, 8)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {quotes === null
            ? "Cotizaciones pendientes."
            : quotes.state === "read"
              ? `Schwab · ${new Date(quotes.readAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}${quotes.invalidSymbols.length ? ` · ${quotes.invalidSymbols.length} sin cotizar` : ""}`
              : quotes.state === "limit_reached"
                ? "Hay más de 50 símbolos activos. Archivá ideas para volver a cotizar toda la watchlist."
                : "Cotizaciones no disponibles; el plan guardado conserva sus niveles."}
          {ideas.length === 0 ? null : (
            <> · cada guardado conserva la revisión anterior</>
          )}
        </p>
      </section>
    </div>
  );
}
