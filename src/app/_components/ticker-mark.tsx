import { companyLogoAssetUrl } from "@/modules/configuration/domain/company-logo";

import { CompanyMark } from "./company-mark";

/** Identidad compacta de trading: placa cuadrada, logo entero y ticker al lado. */
export function TickerMark({
  ticker,
  name = null,
  size = "sm",
  className,
}: {
  readonly ticker: string;
  readonly name?: string | null;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}) {
  return (
    <CompanyMark
      ticker={ticker}
      name={name}
      logoUrl={companyLogoAssetUrl(ticker)}
      size={size}
      shape="rounded"
      className={className}
    />
  );
}
