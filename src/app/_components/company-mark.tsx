"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  companyHue,
  companyInitials,
} from "@/modules/configuration/domain/company-logo";

import { useCompanyLogoFit } from "./use-company-logo-fit";

const SIZES = {
  sm: "size-6 text-[0.625rem]",
  md: "size-8 text-xs",
  lg: "size-12 text-base",
} as const;

/**
 * La marca de una empresa (ADR 0077): su logo guardado sobre una placa
 * cuadrada con esquinas redondeadas al 20 %, blanca en los dos temas —muchos
 * logos son oscuros sobre transparente y se perderían en el oscuro— o, si la
 * imagen no carga, un monograma con sus iniciales sobre un color estable por
 * ticker y el mismo contorno. Es la misma marca en análisis y en trading; los
 * gráficos dibujan la suya, circular (`matrix-chart`).
 *
 * El logo entra entero, sin recortar, con `contain`: una placa de fondo
 * lleno ocupa todo el cuadrado y queda como un ícono; un dibujo sobre
 * transparente, que toca sus bordes, lleva un margen (`companyLogoFit`).
 * Hasta leer sus esquinas no se muestra, para que no cambie de tamaño.
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
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const fit = useCompanyLogoFit(
    logoUrl !== null && failedUrl !== logoUrl ? logoUrl : null,
  );

  // Un 404 que llegó antes de hidratar no dispara `onError`: la imagen ya
  // terminó, rota. Se mira una vez al montar.
  useEffect(() => {
    const node = image.current;
    if (node?.complete && node.naturalWidth === 0) setFailedUrl(logoUrl);
  }, [logoUrl]);

  if (logoUrl !== null && failedUrl !== logoUrl) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-foreground/10",
          SIZES[size],
          "rounded-[20%]",
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
            fit === "inset" ? "size-[78%]" : "size-full",
            fit === null && "opacity-0",
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
        "rounded-[20%]",
        className,
      )}
      style={{ backgroundColor: `oklch(0.48 0.11 ${companyHue(ticker)})` }}
    >
      {companyInitials(name, ticker)}
    </span>
  );
}
