"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CompanyMark } from "@/app/_components/company-mark";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { displayCompanyName } from "@/modules/companies/domain/display-company-name";
import type { ValuedCompany } from "@/modules/valuation/application/read-valued-companies";
import {
  formatAmount,
  formatCalendarDate,
} from "@/modules/valuation/domain/display-format";
import type { MarketPriceComparisonUnavailableReason } from "@/modules/valuation/domain/market-implied";

import { methodCopy } from "./method-copy";
import { RunStatusMark } from "./run/data-marks";

export type ValuedCompanyRow = ValuedCompany & {
  readonly logoUrl: string | null;
};

/** Por qué no hay precio ÷ valor, en dos o tres palabras. */
const GAP_COPY: Record<MarketPriceComparisonUnavailableReason, string> = {
  no_value_per_share: "sin valor",
  no_close_at_as_of: "sin cierre ese día",
  currency_mismatch: "otra moneda",
  non_positive_close: "cierre no positivo",
  non_positive_value: "valor no positivo",
  split_after_share_basis: "split en el medio",
};

type SortKey = "name" | "priceToValue" | "asOf";
type Sort = { key: SortKey; direction: "ascending" | "descending" };

const SORT_LABELS: Record<SortKey, string> = {
  name: "Empresa",
  priceToValue: "Price / value",
  asOf: "Valuada al",
};

/** La primera dirección de cada columna: la fecha arranca por lo último. */
const FIRST_DIRECTION: Record<SortKey, Sort["direction"]> = {
  name: "ascending",
  priceToValue: "ascending",
  asOf: "descending",
};

function nameOf(company: ValuedCompanyRow): string {
  return company.legalName === null
    ? (company.ticker ?? "")
    : displayCompanyName(company.legalName);
}

/**
 * Ordena sin perder a nadie: lo que no tiene la cifra va siempre al final.
 * El `Number` sólo ordena; la cifra que se lee es el decimal exacto.
 */
function sortCompanies(
  companies: readonly ValuedCompanyRow[],
  sort: Sort,
): ValuedCompanyRow[] {
  const sign = sort.direction === "ascending" ? 1 : -1;

  return [...companies].sort((left, right) => {
    if (sort.key === "priceToValue") {
      if (left.priceToValue === null || right.priceToValue === null) {
        return (
          Number(left.priceToValue === null) -
          Number(right.priceToValue === null)
        );
      }
      return sign * (Number(left.priceToValue) - Number(right.priceToValue));
    }
    if (sort.key === "asOf") {
      return (
        sign * left.asOf.localeCompare(right.asOf) ||
        nameOf(left).localeCompare(nameOf(right), "es")
      );
    }
    return sign * nameOf(left).localeCompare(nameOf(right), "es");
  });
}

function SortHeader({
  sortKey,
  sort,
  onSort,
  align,
}: {
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const active = sort.key === sortKey;
  const Icon = !active
    ? ArrowUpDown
    : sort.direction === "ascending"
      ? ArrowUp
      : ArrowDown;

  return (
    <TableHead
      scope="col"
      aria-sort={active ? sort.direction : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {SORT_LABELS[sortKey]}
        <Icon
          aria-hidden="true"
          className={active ? "size-3.5" : "size-3.5 opacity-50"}
        />
      </button>
    </TableHead>
  );
}

/**
 * Lo valuado, una fila por empresa: price ÷ value primero, porque es lo que
 * se compara, y después de qué cifras sale. Ordenable por nombre, por precio
 * sobre valor o por fecha (`aria-sort`).
 */
export function ValuedCompaniesTable({
  companies,
}: {
  companies: readonly ValuedCompanyRow[];
}) {
  const [sort, setSort] = useState<Sort>({
    key: "asOf",
    direction: "descending",
  });
  const rows = sortCompanies(companies, sort);

  function toggle(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction:
              current.direction === "ascending" ? "descending" : "ascending",
          }
        : { key, direction: FIRST_DIRECTION[key] },
    );
  }

  return (
    <Table containerLabel="Empresas valuadas, tabla desplazable">
      <TableHeader>
        <TableRow>
          <SortHeader sortKey="name" sort={sort} onSort={toggle} />
          <SortHeader
            sortKey="priceToValue"
            sort={sort}
            onSort={toggle}
            align="right"
          />
          <TableHead scope="col" className="text-right">
            Value per share
          </TableHead>
          <TableHead scope="col" className="text-right">
            Precio
          </TableHead>
          <TableHead scope="col">Estado</TableHead>
          <TableHead scope="col">Método</TableHead>
          <SortHeader sortKey="asOf" sort={sort} onSort={toggle} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((company, index) => {
          const name = nameOf(company);

          return (
            <TableRow key={company.ticker ?? `sin-ticker-${index}`}>
              <TableHead scope="row" className="font-normal">
                <span className="flex items-center gap-2.5">
                  <CompanyMark
                    ticker={company.ticker ?? name}
                    name={name}
                    logoUrl={company.logoUrl}
                    size="sm"
                  />
                  {company.ticker === null ? (
                    <span>{name}</span>
                  ) : (
                    <Link
                      href={`/valuacion/${encodeURIComponent(company.ticker)}`}
                      className="group flex min-w-0 flex-col rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="max-w-56 truncate font-medium group-hover:underline group-hover:underline-offset-4">
                        {name}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {company.ticker}
                      </span>
                    </Link>
                  )}
                </span>
              </TableHead>
              <TableCell className="text-right">
                {company.priceToValue === null ? (
                  <span className="text-xs text-muted-foreground">
                    {company.comparisonGap === null
                      ? "—"
                      : GAP_COPY[company.comparisonGap]}
                  </span>
                ) : (
                  <span className="numeric font-semibold">
                    {formatAmount(company.priceToValue, { scale: 2 })}×
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {company.valuePerShare === null ? (
                  <span className="text-xs text-muted-foreground">
                    sin valor
                  </span>
                ) : (
                  <span className="numeric">
                    {formatAmount(company.valuePerShare)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {company.currency}
                    </span>
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {company.close === null ? (
                  <span className="text-xs text-muted-foreground">
                    sin cierre
                  </span>
                ) : (
                  <span className="numeric">
                    {formatAmount(company.close.close)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {company.close.currency}
                    </span>
                  </span>
                )}
              </TableCell>
              <TableCell>
                <RunStatusMark status={company.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {methodCopy(company.method)}
              </TableCell>
              <TableCell>
                <time className="numeric" dateTime={company.asOf}>
                  {formatCalendarDate(company.asOf)}
                </time>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
