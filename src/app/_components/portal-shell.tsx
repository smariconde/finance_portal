import type { ReactNode } from "react";

import { AppSidebar } from "@/app/_components/app-sidebar";
import { StatusMark } from "@/app/_components/status-mark";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ConfigHealth } from "@/modules/configuration/domain/config-health";

type PortalShellProps = {
  children: ReactNode;
  health: ConfigHealth;
};

export function PortalShell({ children, health }: PortalShellProps) {
  const needsAttention = health.items.some(
    (item) => item.status === "degraded",
  );

  return (
    <TooltipProvider>
      <SidebarProvider>
        <a className="skip-link" href="#contenido">
          Saltar al contenido
        </a>
        <AppSidebar mode={health.mode} />
        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger
                className="size-11 md:size-7"
                aria-label="Abrir o cerrar navegación"
              />
              <div className="h-4 w-px bg-border" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  Portal Financiero
                </p>
                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                  Investigación reproducible y trazable
                </p>
              </div>
            </div>
            <StatusMark
              status={
                health.mode === "personal"
                  ? needsAttention
                    ? "degraded"
                    : "ready"
                  : "disabled"
              }
              label={
                health.mode === "personal"
                  ? `Personal${needsAttention ? " · atención" : " · estable"}`
                  : "Trabado"
              }
            />
          </header>

          {children}

          <footer className="mt-auto flex flex-col gap-1 border-t px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-6">
            <p>Información educativa, no asesoramiento financiero.</p>
            <p>
              {health.mode === "personal"
                ? "Portal personal · código público · datos reales protegidos"
                : "Runtime trabado · no se sirven datos"}
            </p>
          </footer>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
