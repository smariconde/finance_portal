"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  companyHue,
  companyInitials,
} from "@/modules/configuration/domain/company-logo";

const SIZES = {
  sm: "size-6 text-[0.625rem]",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
} as const;

/**
 * La marca de una empresa (ADR 0077): su logo guardado sobre una placa
 * blanca en los dos temas —muchos logos son oscuros sobre transparente y se
 * perderían en el oscuro— o, si la imagen no carga, un monograma
 * con sus iniciales sobre un color estable por ticker.
 *
 * El logo entra entero, sin recortar: cada empresa publica otra proporción y
 * otro margen, así que se ajusta con `contain`: en el círculo conserva el
 * margen inscripto; en trading llena el cuadrado con esquinas redondeadas.
 *
 * Es decorativa: el nombre y el ticker siempre están al lado, así que la
 * imagen lleva `alt=""` y el monograma `aria-hidden`.
 */
export function CompanyMark({
  ticker,
  name,
  logoUrl,
  size = "md",
  shape = "circle",
  className,
}: {
  ticker: string;
  name: string | null;
  logoUrl: string | null;
  size?: keyof typeof SIZES;
  shape?: "circle" | "rounded";
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);

  // Un 404 que llegó antes de hidratar no dispara `onError`: la imagen ya
  // terminó, rota. Se mira una vez al montar.
  useEffect(() => {
    const node = image.current;
    if (node?.complete && node.naturalWidth === 0) setFailedUrl(logoUrl);
  }, [logoUrl]);

  const contour = shape === "rounded" ? "rounded-[20%]" : "rounded-full";

  if (logoUrl !== null && failedUrl !== logoUrl) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-foreground/10",
          SIZES[size],
          contour,
          className,
        )}
      >
        {/*
         * Imagen propia de 128 px, ya validada y guardada. No necesita otra
         * caché ni transformación en el optimizador de Next.
         */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={image}
          src={logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          width={128}
          height={128}
          className={cn(
            "object-contain",
            shape === "rounded" ? "size-full" : "size-[72%]",
          )}
          onError={() => setFailedUrl(logoUrl)}
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
        contour,
        className,
      )}
      style={{ backgroundColor: `oklch(0.48 0.11 ${companyHue(ticker)})` }}
    >
      {companyInitials(name, ticker)}
    </span>
  );
}
