import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import {
  CHANGE_TONE_CLASS,
  changeTone,
  decimalSign,
  type ChangePolarity,
} from "./change-tone";

/**
 * El cambio de una métrica contra su lectura anterior: flecha, signo escrito y
 * color dicen lo mismo, así el color nunca es el único canal. `amount` es el
 * decimal crudo que decide el sentido; `text`, cómo se escribe (ya con su
 * signo y unidad).
 */
export function ChangeIndicator({
  amount,
  text,
  polarity,
  context,
  className,
}: {
  readonly amount: string;
  readonly text: string;
  readonly polarity: ChangePolarity;
  /** Contra qué se compara: «vs. jul», «vs. 2024». */
  readonly context?: ReactNode;
  readonly className?: string;
}) {
  const sign = decimalSign(amount);
  const Icon = sign > 0 ? ArrowUpRight : sign < 0 ? ArrowDownRight : Minus;

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-1 text-xs leading-4",
        className,
      )}
    >
      <span
        className={cn(
          "numeric inline-flex items-center gap-0.5 font-medium",
          CHANGE_TONE_CLASS[changeTone(amount, polarity)],
        )}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {text}
      </span>
      {context === undefined ? null : (
        <span className="text-muted-foreground">{context}</span>
      )}
    </span>
  );
}

/**
 * Una cifra con su rótulo: el tile de las lecturas rápidas (Argentina, precio
 * contra valor, calidad de una matriz). `card` va suelto en la página, con su
 * borde; `inset` va dentro de una card y se apoya en un fondo tenue, sin una
 * card adentro de otra.
 */
export function StatTile({
  label,
  labelAside,
  value,
  unit,
  detail,
  change,
  footer,
  href,
  variant = "card",
  size = "default",
  className,
}: {
  readonly label: ReactNode;
  /** Al lado del rótulo: un `InfoTip`. No va en un tile con `href`. */
  readonly labelAside?: ReactNode;
  readonly value: ReactNode;
  readonly unit?: ReactNode;
  readonly detail?: ReactNode;
  readonly change?: ReactNode;
  /** Abajo de todo: la fecha del dato. */
  readonly footer?: ReactNode;
  readonly href?: string;
  readonly variant?: "card" | "inset";
  /** `sm` para una grilla de seis; `lg` para la cifra que manda en la página. */
  readonly size?: "sm" | "default" | "lg";
  readonly className?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
        {label}
        {labelAside}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span
          data-slot="stat-value"
          className={cn(
            "numeric leading-none font-semibold tracking-tight whitespace-nowrap text-foreground transition-colors motion-reduce:transition-none",
            size === "lg" ? "text-3xl" : size === "sm" ? "text-xl" : "text-2xl",
          )}
        >
          {value}
        </span>
        {unit === undefined ? null : (
          <span className="text-sm text-muted-foreground">{unit}</span>
        )}
      </span>
      {change}
      {detail === undefined ? null : (
        <span className="text-xs leading-4 text-muted-foreground">
          {detail}
        </span>
      )}
      {footer === undefined ? null : (
        <span className="numeric mt-auto pt-1 text-xs text-muted-foreground">
          {footer}
        </span>
      )}
    </>
  );

  const classes = cn(
    "flex min-w-0 flex-col gap-2",
    variant === "card"
      ? "rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10"
      : "rounded-lg bg-muted/50 p-3",
    href !== undefined &&
      "transition-[box-shadow,background-color] outline-none hover:ring-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
    href !== undefined && variant === "inset" && "hover:bg-muted",
    className,
  );

  if (href === undefined) {
    return <div className={classes}>{body}</div>;
  }

  return href.startsWith("#") ? (
    <a href={href} className={classes}>
      {body}
    </a>
  ) : (
    <Link href={href as Route} className={classes}>
      {body}
    </Link>
  );
}
