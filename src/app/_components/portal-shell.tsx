import Link from "next/link";
import type { ReactNode } from "react";

import type { AppMode } from "@/modules/configuration/domain/config-health";

type PortalShellProps = {
  children: ReactNode;
  mode: AppMode;
};

export function PortalShell({ children, mode }: PortalShellProps) {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>

      <header className="site-header">
        <Link
          className="wordmark"
          href="/"
          aria-label="Portal Financiero, inicio"
        >
          <span className="wordmark-mark" aria-hidden="true">
            PF
          </span>
          <span>Portal Financiero</span>
        </Link>

        <nav className="site-nav" aria-label="Navegación principal">
          <Link href="/">Inicio</Link>
          <Link href="/configuracion">Configuración</Link>
        </nav>

        <div className="mode-indicator">
          <span className="mode-signal" aria-hidden="true" />
          <span className="mode-label">Modo </span>
          {mode}
        </div>
      </header>

      {children}

      <footer className="site-footer">
        <p>Información educativa, no asesoramiento financiero.</p>
        <p>Portal personal · código público · datos reales protegidos</p>
      </footer>
    </div>
  );
}
