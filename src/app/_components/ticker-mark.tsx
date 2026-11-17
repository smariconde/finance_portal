import { companyLogoAssetUrl } from "@/modules/configuration/domain/company-logo";

import { CompanyMark } from "./company-mark";

/** La marca de trading: el logo guardado por ticker, sin pasar la URL. */
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
      className={className}
    />
  );
}
