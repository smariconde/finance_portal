"use client";

import {
  Ban,
  CheckCircle2,
  CircleDashed,
  OctagonX,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { Segmented } from "@/app/_components/segmented";
import { formatMoney } from "@/app/_components/trading-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  planByAmount,
  planPosition,
  POSITION_SIZE_AMOUNT_VERSION,
  POSITION_SIZE_RISK_VERSION,
  type AmountPlan,
  type OpenRisk,
  type PlannerCap,
  type PositionPlan,
  type PositionRisk,
  type PositionRiskReason,
} from "@/modules/trading/domain/position-size-risk";
import { priceInputSchema } from "@/modules/trading/domain/trade-annotation";
import {
  COUNT_RULE_MAX,
  ruleUsage,
  TRADING_RULES_VERSION,
  type RiskSettings,
  type RuleReading,
  type RuleState,
  type RuleUnknownReason,
  type TradingRule,
} from "@/modules/trading/domain/trading-rules";
import { formatAmount } from "@/modules/valuation/domain/display-format";

import { saveRiskSettings, type SaveRiskSettingsResult } from "../actions";

/**
 * El riesgo de la cuenta (`F11-09`, ADR 0076): las cuatro reglas del día como
 * medidores, el planner 2 % / 6 % con precios que escribe el owner y el editor
 * de sus reglas. Nada bloquea: el portal no envía órdenes. El cálculo es
 * `position-size-risk-1.0.0` y `trading-rules-1.0.0`, en decimal; `number`
 * sólo para la geometría de las barras.
 */

const formatPercent = (value: string) =>
  `${formatAmount(value, { scale: 1 })} %`;

const RULE_VIEW: Readonly<
  Record<TradingRule, { readonly term: string; readonly gloss: string }>
> = {
  open_risk: { term: "Open risk", gloss: "riesgo abierto" },
  daily_loss: { term: "Daily loss", gloss: "pérdida del día" },
  trades: { term: "Trades", gloss: "abiertos hoy" },
  loss_streak: { term: "Loss streak", gloss: "pérdidas seguidas" },
};

const STATE_VIEW: Readonly<
  Record<
    RuleState,
    {
      readonly label: string;
      readonly icon: typeof CheckCircle2;
      readonly tone: string;
      readonly fill: string;
    }
  >
> = {
  ok: {
    label: "OK",
    icon: CheckCircle2,
    tone: "text-emerald-700 dark:text-emerald-300",
    fill: "bg-emerald-600 dark:bg-emerald-500",
  },
  warning: {
    label: "Atención",
    icon: TriangleAlert,
    tone: "text-amber-800 dark:text-amber-300",
    fill: "bg-amber-500 dark:bg-amber-400",
  },
  stop: {
    label: "Cortar",
    icon: OctagonX,
    tone: "text-red-700 dark:text-red-400",
    fill: "bg-red-600 dark:bg-red-500",
  },
  off: {
    label: "Apagada",
    icon: Ban,
    tone: "text-muted-foreground",
    fill: "bg-muted-foreground",
  },
  unknown: {
    label: "Sin medir",
    icon: CircleDashed,
    tone: "text-muted-foreground",
    fill: "bg-muted-foreground",
  },
};

const UNKNOWN_COPY: Readonly<Record<RuleUnknownReason, string>> = {
  open_risk_incomplete: "Hay posiciones sin stop: el total no se puede sumar.",
  open_day_pnl_unknown: "Schwab no publicó el P&L del día de alguna posición.",
  no_equity: "La cuenta no tiene valor de liquidación positivo.",
};

const STATE_HINT: Readonly<Record<TradingRule, string>> = {
  open_risk:
    "Lo que se pierde si todos los stops saltan ahora: (precio − stop) × cantidad. Atención cuando otro trade completo ya no entra; cortar al llegar al límite.",
  daily_loss:
    "Realizado en la sesión de Nueva York más el P&L abierto del día de Schwab, contra el valor de liquidación al abrir.",
  trades: "Trades que abrieron en la sesión de Nueva York de hoy.",
  loss_streak:
    "Trades cerrados hoy con pérdida, seguidos; uno en cero o en ganancia corta la racha.",
};

export type RiskView =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly reference: string | null }
  | {
      readonly state: "read";
      readonly settings: RiskSettings;
      readonly settingsRevision: number | null;
      readonly rules: readonly RuleReading[];
      readonly openRisk: OpenRisk;
      readonly syncFailed: string | null;
    };

function StateBadge({ state }: { readonly state: RuleState }) {
  const view = STATE_VIEW[state];
  const Icon = view.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        view.tone,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {view.label}
    </span>
  );
}

function usedText(reading: RuleReading): string | null {
  if (reading.used === null || reading.limit === null) return null;
  if (reading.rule === "trades" || reading.rule === "loss_streak") {
    return `${reading.used} de ${reading.limit}`;
  }
  return `US$ ${formatMoney(reading.used)} de ${formatMoney(reading.limit)}`;
}

/** Barra continua para los de dinero; casilleros para los de conteo. */
function RuleMeter({ reading }: { readonly reading: RuleReading }) {
  const view = STATE_VIEW[reading.state];
  const isCount = reading.rule === "trades" || reading.rule === "loss_streak";
  const text = usedText(reading);
  const label = `${RULE_VIEW[reading.rule].term}: ${view.label}${text === null ? "" : `, ${text}`}`;

  if (isCount && reading.used !== null && reading.limit !== null) {
    const used = Number(reading.used);
    const limit = Number(reading.limit);
    return (
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="flex items-center gap-1"
      >
        {Array.from({ length: limit }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-2 flex-1 rounded-full",
              index < used ? view.fill : "bg-muted",
            )}
          />
        ))}
        {used > limit ? (
          <span className={cn("numeric text-xs font-medium", view.tone)}>
            +{used - limit}
          </span>
        ) : null}
      </div>
    );
  }

  const usage = ruleUsage(reading);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={usage === null ? 0 : Math.round(Math.min(usage, 1) * 100)}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      {usage === null ? null : (
        <span
          className={cn("block h-full rounded-full", view.fill)}
          style={{ width: `${Math.min(usage, 1) * 100}%` }}
        />
      )}
    </div>
  );
}

function RuleTile({
  reading,
  extra,
}: {
  readonly reading: RuleReading;
  readonly extra?: ReactNode;
}) {
  const text = usedText(reading);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="flex items-center gap-0.5 text-sm font-medium">
          {RULE_VIEW[reading.rule].term}
          <InfoTip title={RULE_VIEW[reading.rule].term}>
            <p>{STATE_HINT[reading.rule]}</p>
            {reading.reason === null ? null : (
              <p>{UNKNOWN_COPY[reading.reason]}</p>
            )}
          </InfoTip>
        </span>
        <StateBadge state={reading.state} />
      </div>
      <RuleMeter reading={reading} />
      <span className="numeric text-xs text-muted-foreground">
        {text ??
          (reading.limit === null
            ? RULE_VIEW[reading.rule].gloss
            : `límite US$ ${formatMoney(reading.limit)}`)}
        {extra}
      </span>
    </div>
  );
}

const CAP_COPY: Readonly<Record<PlannerCap, string>> = {
  risk_per_trade: "risk por trade",
  buying_power: "buying power",
  open_risk: "open risk",
};

const INVALID_COPY = {
  no_equity: "Sin valor de liquidación",
  stop_on_wrong_side: "El stop va debajo de la entrada",
  zero_risk: "El stop es igual a la entrada",
} as const;

function readPrice(value: string): string | null | "invalid" {
  const parsed = priceInputSchema.safeParse(value);
  return parsed.success ? parsed.data : "invalid";
}

function PriceField({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid: boolean;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs font-medium">
      {label}
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className="numeric"
      />
    </label>
  );
}

function Fact({
  term,
  value,
  detail,
}: {
  readonly term: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="numeric text-sm font-semibold">
        {value}
        {detail === undefined ? null : (
          <span className="ml-1 font-normal text-muted-foreground">
            {detail}
          </span>
        )}
      </dd>
    </div>
  );
}

type PlannerMode = "risk" | "amount";

const PLANNER_MODES: readonly { value: PlannerMode; label: string }[] = [
  { value: "risk", label: "Por riesgo" },
  { value: "amount", label: "Por monto" },
];

/**
 * El planner, en dos modos. Por riesgo: entrada, stop y target; sale cuántas
 * acciones comprar con el mínimo entre el 2 %, el buying power y lo que le queda
 * al 6 % (`position-size-risk-1.0.0`). Por monto: cuánto poner y la entrada;
 * sale cuántas acciones son y, con stop, si el riesgo entra en el 2 %
 * (`position-size-amount-1.0.0`). No cotiza nada: el cliente nunca nombra un
 * ticker ante Schwab.
 */
function Planner({
  settings,
  liquidationValue,
  buyingPower,
  openRisk,
}: {
  readonly settings: RiskSettings;
  readonly liquidationValue: string;
  readonly buyingPower: string;
  readonly openRisk: OpenRisk;
}) {
  const ids = useId();
  const [mode, setMode] = useState<PlannerMode>("risk");
  const [amountText, setAmount] = useState("");
  const [entryText, setEntry] = useState("");
  const [stopText, setStop] = useState("");
  const [targetText, setTarget] = useState("");
  const amount = readPrice(amountText);
  const entry = readPrice(entryText);
  const stop = readPrice(stopText);
  const target = readPrice(targetText);

  const byRisk =
    mode === "risk" &&
    entry !== null &&
    entry !== "invalid" &&
    stop !== null &&
    stop !== "invalid" &&
    target !== "invalid"
      ? planPosition({
          liquidationValue,
          buyingPower,
          riskPerTradePercent: settings.riskPerTradePercent,
          openRiskPercent: settings.openRiskPercent,
          openRisk: openRisk.value,
          entry,
          stop,
          target,
        })
      : null;
  const byAmount =
    mode === "amount" &&
    amount !== null &&
    amount !== "invalid" &&
    entry !== null &&
    entry !== "invalid" &&
    stop !== "invalid" &&
    target !== "invalid"
      ? planByAmount({
          liquidationValue,
          buyingPower,
          riskPerTradePercent: settings.riskPerTradePercent,
          amount,
          entry,
          stop,
          target,
        })
      : null;
  const invalid =
    byRisk?.state === "invalid"
      ? byRisk.reason
      : byAmount?.state === "invalid"
        ? byAmount.reason
        : null;

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-3 border-t pt-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={`${ids}-title`}
          className="flex items-center gap-0.5 text-sm font-medium"
        >
          Position size
          <InfoTip title="Position size">
            <p>
              Por riesgo: shares = el mínimo entre{" "}
              {formatPercent(settings.riskPerTradePercent)} del valor de
              liquidación sobre (entrada − stop), el buying power y lo que le
              queda al {formatPercent(settings.openRiskPercent)} de open risk.
            </p>
            <p>
              Por monto: shares = monto ÷ entrada. Con stop, el riesgo de esas
              shares contra el {formatPercent(settings.riskPerTradePercent)}.
            </p>
            <p>Enteras, hacia abajo.</p>
            <p className="font-mono text-xs">
              {POSITION_SIZE_RISK_VERSION} · {POSITION_SIZE_AMOUNT_VERSION}
            </p>
          </InfoTip>
        </h3>
        <Segmented
          label="Modo del position size"
          options={PLANNER_MODES}
          value={mode}
          onChange={setMode}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-center">
        <div
          className={cn(
            "grid gap-2",
            mode === "amount" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
          )}
        >
          {mode === "amount" ? (
            <PriceField
              id={`${ids}-amount`}
              label="Monto, US$"
              value={amountText}
              onChange={setAmount}
              invalid={amount === "invalid"}
            />
          ) : null}
          <PriceField
            id={`${ids}-entry`}
            label="Entrada"
            value={entryText}
            onChange={setEntry}
            invalid={entry === "invalid"}
          />
          <PriceField
            id={`${ids}-stop`}
            label={mode === "amount" ? "Stop (opc.)" : "Stop"}
            value={stopText}
            onChange={setStop}
            invalid={stop === "invalid"}
          />
          <PriceField
            id={`${ids}-target`}
            label="Target (opc.)"
            value={targetText}
            onChange={setTarget}
            invalid={target === "invalid"}
          />
        </div>
        <div
          aria-live="polite"
          className="flex min-h-16 items-center rounded-lg bg-muted/50 px-4 py-3"
        >
          {invalid !== null ? (
            <p className="flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
              <TriangleAlert className="size-4" aria-hidden="true" />
              {INVALID_COPY[invalid]}
            </p>
          ) : byRisk?.state === "planned" ? (
            <RiskResult plan={byRisk} />
          ) : byAmount?.state === "planned" ? (
            <AmountResult
              plan={byAmount}
              riskPerTradePercent={settings.riskPerTradePercent}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {mode === "risk" ? "Entrada y stop." : "Monto y entrada."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SharesFigure({
  shares,
  children,
}: {
  readonly shares: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">Shares</dt>
      <dd className="numeric text-3xl leading-none font-semibold">
        {formatAmount(shares, { scale: 0 })}
      </dd>
      {children}
    </div>
  );
}

function rewardRiskText(value: string | null): string {
  return value === null ? "—" : formatAmount(value, { scale: 2 });
}

function RiskResult({
  plan,
}: {
  readonly plan: Extract<PositionPlan, { state: "planned" }>;
}) {
  return (
    <dl className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <SharesFigure shares={plan.shares}>
        <dd className="mt-1 flex items-center text-xs text-muted-foreground">
          tope: {CAP_COPY[plan.binding]}
          <InfoTip title="Topes">
            <ul className="numeric space-y-1">
              <li>
                Risk por trade:{" "}
                {formatAmount(plan.caps.riskPerTrade, { scale: 0 })}
              </li>
              <li>
                Buying power:{" "}
                {formatAmount(plan.caps.buyingPower, { scale: 0 })}
              </li>
              <li>
                Open risk:{" "}
                {plan.caps.openRisk === null
                  ? "sin medir (posiciones sin stop)"
                  : formatAmount(plan.caps.openRisk, { scale: 0 })}
              </li>
            </ul>
          </InfoTip>
        </dd>
      </SharesFigure>
      <Fact
        term="Posición"
        value={`US$ ${formatMoney(plan.positionValue)}`}
        detail={formatPercent(plan.positionPercent)}
      />
      <Fact
        term="Risk"
        value={`US$ ${formatMoney(plan.riskAmount)}`}
        detail={formatPercent(plan.riskPercent)}
      />
      <Fact term="R:R" value={rewardRiskText(plan.rewardRisk.value)} />
      <Fact
        term="Open risk luego"
        value={
          plan.openRiskAfterPercent === null
            ? "—"
            : formatPercent(plan.openRiskAfterPercent)
        }
      />
    </dl>
  );
}

function AmountResult({
  plan,
  riskPerTradePercent,
}: {
  readonly plan: Extract<AmountPlan, { state: "planned" }>;
  readonly riskPerTradePercent: string;
}) {
  const warn = "text-amber-800 dark:text-amber-300";
  return (
    <dl className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <SharesFigure shares={plan.shares} />
      <div className="flex flex-col">
        <dt className="text-xs text-muted-foreground">Posición</dt>
        <dd
          className={cn(
            "numeric text-sm font-semibold",
            plan.overBuyingPower && warn,
          )}
        >
          US$ {formatMoney(plan.positionValue)}
          <span className="ml-1 font-normal text-muted-foreground">
            {formatPercent(plan.positionPercent)}
          </span>
        </dd>
        {plan.overBuyingPower ? (
          <dd className={cn("flex items-center gap-1 text-xs", warn)}>
            <TriangleAlert className="size-3" aria-hidden="true" />
            Supera el buying power
          </dd>
        ) : (
          <dd className="numeric text-xs text-muted-foreground">
            sobra US$ {formatMoney(plan.leftover)}
          </dd>
        )}
      </div>
      {plan.risk === null ? null : (
        <div className="flex flex-col">
          <dt className="text-xs text-muted-foreground">Risk</dt>
          <dd
            className={cn(
              "numeric text-sm font-semibold",
              plan.risk.overBudget && warn,
            )}
          >
            US$ {formatMoney(plan.risk.amount)}
            <span
              className={cn(
                "ml-1 font-normal",
                plan.risk.overBudget ? warn : "text-muted-foreground",
              )}
            >
              {formatPercent(plan.risk.percent)}
            </span>
          </dd>
          {plan.risk.overBudget ? (
            <dd className={cn("numeric flex items-center gap-1 text-xs", warn)}>
              <TriangleAlert className="size-3" aria-hidden="true" />
              Más de {formatPercent(riskPerTradePercent)}: máx{" "}
              {formatAmount(plan.risk.maxShares, { scale: 0 })} shares
            </dd>
          ) : (
            <dd className="numeric text-xs text-muted-foreground">
              de US$ {formatMoney(plan.risk.budget)}
            </dd>
          )}
        </div>
      )}
      {plan.rewardRisk.reason === "no_stop" ? null : (
        <Fact term="R:R" value={rewardRiskText(plan.rewardRisk.value)} />
      )}
    </dl>
  );
}

type SettingsFields = {
  riskPerTradePercent: string;
  openRiskPercent: string;
  dailyLossPercent: string;
  maxTradesPerSession: string;
  maxConsecutiveLosses: string;
};

function fieldsOf(settings: RiskSettings): SettingsFields {
  const percent = (value: string | null) =>
    value === null ? "" : value.replace(".", ",");
  return {
    riskPerTradePercent: percent(settings.riskPerTradePercent),
    openRiskPercent: percent(settings.openRiskPercent),
    dailyLossPercent: percent(settings.dailyLossPercent),
    maxTradesPerSession: settings.maxTradesPerSession?.toString() ?? "",
    maxConsecutiveLosses: settings.maxConsecutiveLosses?.toString() ?? "",
  };
}

const FIELD_VIEW: readonly {
  readonly key: keyof SettingsFields;
  readonly label: string;
  readonly unit: string;
  readonly optional: boolean;
}[] = [
  {
    key: "riskPerTradePercent",
    label: "Risk por trade",
    unit: "%",
    optional: false,
  },
  { key: "openRiskPercent", label: "Open risk", unit: "%", optional: false },
  { key: "dailyLossPercent", label: "Daily loss", unit: "%", optional: true },
  {
    key: "maxTradesPerSession",
    label: "Trades por sesión",
    unit: "",
    optional: true,
  },
  {
    key: "maxConsecutiveLosses",
    label: "Pérdidas seguidas",
    unit: "",
    optional: true,
  },
];

const SAVE_ERROR_COPY: Readonly<Record<string, string>> = {
  required: "Obligatorio",
  not_a_percent: "Un porcentaje con hasta dos decimales",
  not_a_count: "Un entero",
  out_of_range: "Fuera de rango",
  per_trade_above_open: "No puede superar al open risk",
};

function SettingsEditor({
  settings,
  revision,
  onSaved,
}: {
  readonly settings: RiskSettings;
  readonly revision: number | null;
  readonly onSaved: (settings: RiskSettings, revision: number) => void;
}) {
  const ids = useId();
  const [fields, setFields] = useState(() => fieldsOf(settings));
  const [base, setBase] = useState(revision);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveRiskSettingsResult | null>(null);

  async function save() {
    setSaving(true);
    let outcome: SaveRiskSettingsResult;
    try {
      outcome = await saveRiskSettings({ baseRevision: base, fields });
    } catch {
      outcome = { state: "unavailable" };
    }
    setSaving(false);
    setResult(outcome);
    if (outcome.state === "saved" || outcome.state === "unchanged") {
      setBase(outcome.revision);
      setFields(fieldsOf(outcome.settings));
      onSaved(outcome.settings, outcome.revision);
    } else if (outcome.state === "conflict") {
      setBase(outcome.revision);
      setFields(fieldsOf(outcome.settings));
    }
  }

  const invalidField = result?.state === "invalid" ? result.field : null;

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {FIELD_VIEW.map((field) => (
          <label
            key={field.key}
            htmlFor={`${ids}-${field.key}`}
            className="flex flex-col gap-1 text-xs font-medium"
          >
            {field.label}
            <span className="relative">
              <Input
                id={`${ids}-${field.key}`}
                inputMode={field.unit === "%" ? "decimal" : "numeric"}
                autoComplete="off"
                placeholder={field.optional ? "Apagada" : undefined}
                value={fields[field.key]}
                aria-invalid={invalidField === field.key || undefined}
                aria-describedby={
                  invalidField === field.key ? `${ids}-error` : undefined
                }
                onChange={(event) =>
                  setFields((previous) => ({
                    ...previous,
                    [field.key]: event.target.value,
                  }))
                }
                className={cn("numeric", field.unit === "" ? "" : "pr-7")}
              />
              {field.unit === "" ? null : (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground"
                >
                  {field.unit}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Guardar
        </Button>
        <span
          id={`${ids}-error`}
          role="status"
          className="text-sm text-muted-foreground"
        >
          {result === null
            ? `Vacío apaga la regla · máximo ${COUNT_RULE_MAX}`
            : result.state === "saved"
              ? "Guardadas"
              : result.state === "unchanged"
                ? "Sin cambios"
                : result.state === "conflict"
                  ? "Otra pestaña guardó antes: revisá y guardá de nuevo"
                  : result.state === "invalid"
                    ? `${FIELD_VIEW.find((field) => field.key === result.field)?.label ?? "Un campo"}: ${SAVE_ERROR_COPY[result.code] ?? "inválido"}`
                    : "La base de trading no respondió"}
        </span>
      </div>
    </form>
  );
}

/** La franja de riesgo de la cuenta: reglas, planner y editor. */
export function RiskCard({
  view,
  liquidationValue,
  buyingPower,
  onSettingsSaved,
}: {
  readonly view: RiskView;
  readonly liquidationValue: string;
  readonly buyingPower: string;
  readonly onSettingsSaved: (settings: RiskSettings, revision: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const editorId = useId();

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b">
        <CardTitle as="h2" className="flex items-center gap-1">
          Riesgo
          <InfoTip title="Riesgo">
            <p>
              Alertas: ninguna regla bloquea nada. El stop de cada posición es
              el del plan del diario; sin plan, la orden stop viva de Schwab.
            </p>
            <p className="font-mono text-xs">{TRADING_RULES_VERSION}</p>
          </InfoTip>
        </CardTitle>
        {view.state === "read" ? (
          <div className="flex items-center gap-2">
            {view.settingsRevision === null ? (
              <span className="text-xs text-muted-foreground">
                Reglas por defecto
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={editing}
              aria-controls={editorId}
              onClick={() => setEditing((open) => !open)}
            >
              <Settings2 data-icon="inline-start" aria-hidden="true" />
              Reglas
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {view.state === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden="true" />
            Leyendo planes y reglas…
          </p>
        ) : view.state === "failed" ? (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <TriangleAlert className="size-4" aria-hidden="true" />
            Base de trading no disponible
            {view.reference === null ? null : (
              <code className="font-mono text-xs">{view.reference}</code>
            )}
          </p>
        ) : (
          <>
            {editing ? (
              <div id={editorId}>
                <SettingsEditor
                  settings={view.settings}
                  revision={view.settingsRevision}
                  onSaved={onSettingsSaved}
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
              {view.rules.map((reading) => (
                <RuleTile
                  key={reading.rule}
                  reading={reading}
                  extra={
                    reading.rule === "open_risk" &&
                    view.openRisk.missing.length > 0 ? (
                      <span className="block text-amber-800 dark:text-amber-300">
                        Sin stop: {view.openRisk.missing.join(", ")}
                      </span>
                    ) : reading.rule === "open_risk" &&
                      view.openRisk.percent !== null ? (
                      <span className="block">
                        {formatPercent(view.openRisk.percent)} de{" "}
                        {formatPercent(view.settings.openRiskPercent)}
                      </span>
                    ) : null
                  }
                />
              ))}
            </div>
            {view.syncFailed === null ? null : (
              <p className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                Transacciones sin actualizar: trades y pérdidas leen lo guardado
                <code className="font-mono">{view.syncFailed}</code>
              </p>
            )}
            <Planner
              settings={view.settings}
              liquidationValue={liquidationValue}
              buyingPower={buyingPower}
              openRisk={view.openRisk}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

const POSITION_REASON_COPY: Readonly<Record<PositionRiskReason, string>> = {
  no_stop: "Sin stop",
  stop_order_partial: "Stop parcial",
  price_through_stop: "Precio bajo el stop",
  asset_not_measured: "No medido",
  short_not_measured: "Corto: no medido",
};

type LevelKey = "stop" | "entry" | "price" | "target";

const LEVEL_SHAPE: Readonly<Record<LevelKey, string>> = {
  stop: "h-4 w-0.5 rounded-full bg-red-600 dark:bg-red-500",
  target: "h-4 w-0.5 rounded-full bg-emerald-600 dark:bg-emerald-500",
  entry: "size-2.5 rounded-full border-2 border-foreground bg-card",
  price: "size-2.5 rotate-45 rounded-[2px] bg-primary ring-2 ring-card",
};

const LEVEL_LABEL: Readonly<Record<LevelKey, string>> = {
  stop: "stop",
  entry: "entrada",
  price: "precio",
  target: "target",
};

/**
 * Stop–entrada–precio–target de una posición sobre un eje de precio: entre el
 * precio y el stop, lo que se arriesga ahora; entre el precio y el target, lo que
 * falta. La misma gramática que el plan del diario (`PlanLadder`).
 */
export function PositionRiskCell({ risk }: { readonly risk: PositionRisk }) {
  const levels = (
    [
      ["stop", risk.stop],
      ["entry", risk.entry],
      ["price", risk.price],
      ["target", risk.target],
    ] as const
  ).filter((level): level is readonly [LevelKey, string] => level[1] !== null);

  const values = levels.map(([, value]) => Number(value));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.max(high * 0.02, 0.01);
  const pad = span * 0.06;
  const at = (value: string) =>
    ((Number(value) - (low - pad)) / (span + 2 * pad)) * 100;
  const zone = (to: string | null, tone: string) => {
    if (to === null) return null;
    const a = at(risk.price);
    const b = at(to);
    return (
      <span
        className={cn("absolute inset-y-0", tone)}
        style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
      />
    );
  };
  const summary = levels
    .map(([key, value]) => `${LEVEL_LABEL[key]} ${formatMoney(value)}`)
    .join(", ");

  return (
    <div className="flex min-w-44 flex-col gap-1">
      <div aria-hidden="true" className="relative mx-1 h-4">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
          {zone(risk.stop, "bg-red-600/25 dark:bg-red-500/30")}
          {zone(risk.target, "bg-emerald-600/20 dark:bg-emerald-500/25")}
        </div>
        {levels.map(([key, value]) => (
          <span
            key={key}
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
              LEVEL_SHAPE[key],
            )}
            style={{ left: `${at(value)}%` }}
          />
        ))}
      </div>
      <span className="sr-only">{summary}.</span>
      <span className="flex flex-wrap items-center gap-x-2 text-xs">
        {risk.risk.value !== null ? (
          <span className="numeric font-medium">
            US$ {formatMoney(risk.risk.value)}
          </span>
        ) : risk.risk.reason === "no_stop" && risk.tradeRef !== null ? (
          <Link
            href={`/diario/${risk.tradeRef}` as Route}
            className="font-medium text-amber-800 underline-offset-4 hover:underline dark:text-amber-300"
          >
            Sin stop · planear
          </Link>
        ) : (
          <span className="text-amber-800 dark:text-amber-300">
            {POSITION_REASON_COPY[risk.risk.reason]}
          </span>
        )}
        {risk.priceInR === null ? null : (
          <span className="numeric text-muted-foreground">
            {formatAmount(risk.priceInR, { scale: 1 })} R
          </span>
        )}
        {risk.lockedIn ? (
          <span className="text-emerald-700 dark:text-emerald-300">
            stop en ganancia
          </span>
        ) : null}
        {risk.stopSource === null ? null : (
          <span className="text-muted-foreground">
            {risk.stopSource === "plan" ? "plan" : "orden"}
          </span>
        )}
        {risk.stopMismatch && risk.orderStop !== null ? (
          <InfoTip title="El stop no coincide">
            <p className="numeric">
              Plan {formatMoney(risk.planStop ?? risk.stop ?? "0")} · orden en
              Schwab {formatMoney(risk.orderStop)}. El riesgo usa el del plan.
            </p>
          </InfoTip>
        ) : null}
      </span>
    </div>
  );
}
