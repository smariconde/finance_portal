"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  companyLogoFit,
  type CompanyLogoFit,
} from "@/modules/configuration/domain/company-logo";

/**
 * Lee las esquinas de cada logo una sola vez por URL y por pestaña. La imagen
 * es el recurso propio del portal (mismo origen, ADR 0077), así que el canvas
 * no queda contaminado y la descarga sale de la caché del navegador.
 */
const fits = new Map<string, CompanyLogoFit>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

function cornerAlphas(image: HTMLImageElement): number[] {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width === 0 || height === 0) return [];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return [];
  context.drawImage(image, 0, 0);

  // Un poco adentro del borde, para no leer el antialias del último píxel.
  const inX = Math.max(1, Math.round(width * 0.04));
  const inY = Math.max(1, Math.round(height * 0.04));
  return [
    [inX, inY],
    [width - 1 - inX, inY],
    [inX, height - 1 - inY],
    [width - 1 - inX, height - 1 - inY],
  ].map(([x, y]) => context.getImageData(x!, y!, 1, 1).data[3]!);
}

function settle(url: string, fit: CompanyLogoFit) {
  fits.set(url, fit);
  pending.delete(url);
  for (const listener of listeners) listener();
}

function measure(url: string) {
  if (fits.has(url) || pending.has(url)) return;
  pending.add(url);

  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    let alphas: number[] = [];
    try {
      alphas = cornerAlphas(image);
    } catch {
      // Sin lectura no se recorta.
    }
    settle(url, companyLogoFit(alphas));
  };
  image.onerror = () => settle(url, "inset");
  image.src = url;
}

/** `null` mientras la imagen no se leyó; en el servidor, siempre `null`. */
export function useCompanyLogoFit(url: string | null): CompanyLogoFit | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      if (url !== null) measure(url);
      return () => {
        listeners.delete(listener);
      };
    },
    [url],
  );

  return useSyncExternalStore(
    subscribe,
    () => (url === null ? null : (fits.get(url) ?? null)),
    () => null,
  );
}
