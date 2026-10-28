"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  companyHue,
  companyInitials,
} from "@/modules/configuration/domain/company-logo";

const SIZES = {
  sm: "size-6 rounded-md text-[0.625rem]",
  md: "size-8 rounded-lg text-xs",
  lg: "size-12 rounded-xl text-base",
} as const;

/**
 * La marca de una empresa (ADR 0062): su logo de logo.dev sobre una placa
 * clara —muchos logos son oscuros sobre transparente y se perderían en el
 * tema oscuro— o, sin clave o si la imagen no carga, un monograma con sus
 * iniciales sobre un color estable por ticker.
 *
 * Es decorativa: el nombre y el ticker siempre están al lado, así que la
 * imagen lleva `alt=""` y el monograma `aria-hidden`.
 */
export function CompanyMark({
  ticker,
  name,
  logoUrl,
  size = "md",
  className,
}: {
  ticker: string;
  name: string | null;
  logoUrl: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);

  // Un 404 que llegó antes de hidratar no dispara `onError`: la imagen ya
  // terminó, rota. Se mira una vez al montar.
  useEffect(() => {
    const node = image.current;
    if (node?.complete && node.naturalWidth === 0) setFailed(true);
  }, []);

  if (logoUrl !== null && !failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-foreground/10",
          SIZES[size],
          className,
        )}
      >
        {/*
         * `<img>` y no `next/image`: el optimizador de Next bajaría el logo
         * desde el servidor, por fuera de la puerta de egress y guardándolo,
         * que es justo lo que el plan gratuito no permite (ADR 0062).
         */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={image}
          src={logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-contain p-[12%]"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold tracking-tight text-white select-none",
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: `oklch(0.48 0.11 ${companyHue(ticker)})` }}
    >
      {companyInitials(name, ticker)}
    </span>
  );
}
