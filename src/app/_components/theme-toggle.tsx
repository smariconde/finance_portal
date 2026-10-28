"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { THEME_STORAGE_KEY as STORAGE_KEY } from "./theme-script";

export type ThemeChoice = "system" | "light" | "dark";

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const COPY: Record<ThemeChoice, string> = {
  system: "el del sistema",
  light: "claro",
  dark: "oscuro",
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readChoice(): ThemeChoice {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "system";
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;

  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;

  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Sin almacenamiento (ventana privada, sitio bloqueado) el tema dura lo
    // que dura la página: sigue funcionando, sólo no se recuerda.
  }

  for (const listener of listeners) listener();
}

/**
 * Tema de toda la app: sistema → claro → oscuro. El icono muestra la elección
 * actual y el nombre accesible dice también a cuál pasa el próximo click.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore(
    subscribe,
    readChoice,
    (): ThemeChoice => "system",
  );
  const next = NEXT[choice];
  const Icon = choice === "light" ? Sun : choice === "dark" ? Moon : Monitor;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:size-8"
            aria-label={`Tema: ${COPY[choice]}. Cambiar a ${COPY[next]}`}
            onClick={() => applyChoice(next)}
          />
        }
      >
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="bottom">Tema: {COPY[choice]}</TooltipContent>
    </Tooltip>
  );
}
