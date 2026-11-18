import { InfoTip } from "@/app/_components/info-tip";
import { CodeValue } from "@/app/valuacion/_components/run/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatAmount,
  formatCalendarDate,
} from "@/modules/valuation/domain/display-format";
import {
  blockAsOf,
  ttmFlowValue,
  type BasePeriod,
  type TtmBasePeriod,
  type TtmFlowItem,
} from "@/modules/valuation/domain/ttm-base-period";
import type { ValuationInput } from "@/modules/valuation/domain/valuation-input";

/**
 * La base del año base (`F6-24`, ADR 0081): TTM al último 10-Q con sus patas,
 * o anual con su motivo. Nada se recalcula acá: `base_period_recomputed` ya
 * reconstruyó cada flujo al correr.
 */

const FLOW_LABELS: Record<TtmFlowItem, string> = {
  revenue: "Revenue · ventas",
  operating_income: "Operating income · resultado operativo",
  pretax_income: "Pretax income · antes de impuestos",
  income_tax: "Income tax · impuesto",
  share_based_compensation: "SBC · compensación en acciones",
  interest_expense: "Interest expense · intereses",
  interest_expense_debt: "Interest on debt · intereses de la deuda",
  finance_lease_interest_expense:
    "Finance lease interest · intereses de arrendamientos",
  interest_net_nonoperating: "Net interest · intereses netos",
  interest_paid: "Interest paid · intereses pagados",
};

const ANNUAL_REASONS: Record<
  Extract<BasePeriod, { basis: "annual" }>["reason"],
  string
> = {
  no_interim_after_fiscal_year: "no hay un 10-Q posterior al último 10-K",
  ttm_leg_missing: "falta un acumulado comparable",
  non_recurring_charge_applied: "el ejercicio revierte un cargo no recurrente",
};

const CORE_REASONS: Record<string, string> = {
  debt_recipe_not_at_quarter: "la receta de deuda no cierra en el 10-Q",
  balance_item_not_at_quarter: "el 10-Q no publica una partida del 10-K",
};

function annualReason(basePeriod: Extract<BasePeriod, { basis: "annual" }>) {
  return `${ANNUAL_REASONS[basePeriod.reason]}${
    basePeriod.item === null ? "" : ` (${FLOW_LABELS[basePeriod.item]})`
  }`;
}

/** El dato de la cabecera: «TTM al …» o «Ejercicio al …». */
export function BasePeriodFact({
  input,
}: {
  input: Pick<ValuationInput, "basePeriod" | "baseRevenue">;
}) {
  const { basePeriod } = input;
  const ttm = basePeriod?.basis === "ttm" ? basePeriod : null;
  const date = ttm?.periodEnd ?? input.baseRevenue.asOf;

  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground">Año base</dt>
      <dd className="flex items-center gap-1">
        <span>
          {ttm === null ? "Ejercicio" : "TTM"} al{" "}
          <time className="numeric" dateTime={date}>
            {formatCalendarDate(date)}
          </time>
        </span>
        <InfoTip title="Año base">
          {ttm !== null
            ? `Doce meses al último 10-Q: el ejercicio del 10-K al ${formatCalendarDate(ttm.fiscalYearEnd)} más lo acumulado este año menos lo acumulado al mismo punto del año anterior.`
            : basePeriod?.basis === "annual"
              ? `El último ejercicio del 10-K: ${annualReason(basePeriod)}.`
              : "El último ejercicio del 10-K: la corrida es anterior al año base TTM o su método lee por ejercicio."}
        </InfoTip>
      </dd>
    </div>
  );
}

/** Las patas del TTM y la fecha de cada bloque de balance. */
export function BasePeriodLegs({
  basePeriod,
  currency,
}: {
  basePeriod: BasePeriod | undefined;
  currency: string;
}) {
  if (basePeriod === undefined) {
    return null;
  }

  if (basePeriod.basis === "annual") {
    return (
      <p className="px-(--card-spacing) pb-3 text-xs text-muted-foreground">
        Año base anual al{" "}
        <time className="numeric" dateTime={basePeriod.fiscalYearEnd}>
          {formatCalendarDate(basePeriod.fiscalYearEnd)}
        </time>
        : {annualReason(basePeriod)}.{" "}
        <CodeValue>{basePeriod.version}</CodeValue>
      </p>
    );
  }

  return <TtmLegs basePeriod={basePeriod} currency={currency} />;
}

function TtmLegs({
  basePeriod,
  currency,
}: {
  basePeriod: TtmBasePeriod;
  currency: string;
}) {
  const first = basePeriod.flows[0]!;
  const balance = [
    {
      label: "Deuda, caja y patrimonio",
      asOf: blockAsOf(basePeriod, "core"),
      reason:
        basePeriod.balance.core.basis === "fiscal_year"
          ? (CORE_REASONS[basePeriod.balance.core.reason] ?? null)
          : null,
    },
    {
      label: "Arrendamientos operativos",
      asOf: blockAsOf(basePeriod, "leases"),
      reason:
        basePeriod.balance.leases.basis === "fiscal_year"
          ? "el 10-Q no publica el pasivo total ni sus dos partes"
          : null,
    },
  ];

  return (
    <div className="flex flex-col gap-3 pb-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-(--card-spacing)">
        <h3 className="text-sm font-medium">
          Año base TTM al{" "}
          <time className="numeric" dateTime={basePeriod.periodEnd}>
            {formatCalendarDate(basePeriod.periodEnd)}
          </time>
        </h3>
        <InfoTip title="Año base TTM">
          Cada flujo es el ejercicio más lo acumulado este año menos lo
          acumulado al mismo punto del año anterior, con el mismo concepto en
          las tres patas. La historia de ventas, la I+D capitalizada, los cargos
          no recurrentes y las opciones siguen en ejercicios del 10-K.
        </InfoTip>
        <CodeValue>{basePeriod.version}</CodeValue>
      </div>
      <Table containerLabel="Patas del año base TTM, tabla desplazable">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Flujo</TableHead>
            <TableHead scope="col" className="text-right">
              Ejercicio
              <time
                className="numeric block text-xs font-normal text-muted-foreground"
                dateTime={basePeriod.fiscalYearEnd}
              >
                {formatCalendarDate(basePeriod.fiscalYearEnd)}
              </time>
            </TableHead>
            <TableHead scope="col" className="text-right">
              + Acumulado
              <time
                className="numeric block text-xs font-normal text-muted-foreground"
                dateTime={first.currentYtd.asOf}
              >
                {formatCalendarDate(first.currentYtd.asOf)}
              </time>
            </TableHead>
            <TableHead scope="col" className="text-right">
              − Acumulado
              <time
                className="numeric block text-xs font-normal text-muted-foreground"
                dateTime={first.priorYtd.asOf}
              >
                {formatCalendarDate(first.priorYtd.asOf)}
              </time>
            </TableHead>
            <TableHead scope="col" className="text-right">
              = TTM
              <span className="block text-xs font-normal text-muted-foreground">
                {currency}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {basePeriod.flows.map((flow) => (
            <TableRow key={flow.item}>
              <TableHead
                scope="row"
                className="min-w-36 font-medium whitespace-normal"
              >
                {FLOW_LABELS[flow.item]}
              </TableHead>
              <TableCell className="numeric text-right">
                {formatAmount(flow.annual.value)}
              </TableCell>
              <TableCell className="numeric text-right">
                {formatAmount(flow.currentYtd.value)}
              </TableCell>
              <TableCell className="numeric text-right">
                {formatAmount(flow.priorYtd.value)}
              </TableCell>
              <TableCell className="numeric text-right font-medium">
                {formatAmount(ttmFlowValue(flow))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <dl className="grid gap-1 px-(--card-spacing) text-xs sm:grid-cols-2">
        {balance.map((block) => (
          <div key={block.label} className="flex flex-wrap gap-x-1.5">
            <dt className="text-muted-foreground">{block.label}</dt>
            <dd>
              <time className="numeric" dateTime={block.asOf}>
                {formatCalendarDate(block.asOf)}
              </time>{" "}
              <span className="text-muted-foreground">
                {block.reason === null ? "· 10-Q" : `· 10-K: ${block.reason}`}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
