import "@fontsource-variable/archivo";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PortalShell } from "@/app/_components/portal-shell";
import { getAppConfigHealth } from "@/server/config/app-environment";

import "./globals.css";

export const metadata: Metadata = {
  title: "Portal Financiero",
  description: "Análisis financiero personal, reproducible y trazable.",
};

const designContract = `
THESIS: Un workspace financiero familiar reduce fricción y deja que evidencia, estado y datos sean protagonistas; rechaza la portada editorial como marco operativo.
OWN-WORLD: Neutrales sobrios, azul funcional, radios moderados, bordes suaves, componentes shadcn/Base UI y numerales tabulares.
STORY: El owner reconoce el modo, encuentra una pregunta disponible y entiende salud, alcance y provenance sin aprender una interfaz propia.
FIRST VIEWPORT: Sidebar colapsable, header compacto y contenido en cards claras; la acción y el estado operativo aparecen antes del detalle.
FORM: Category-standard financial dashboard elegido por el usuario; canon shadcn-finance-20260821.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
`.trim();

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const health = getAppConfigHealth();

  return (
    <html lang="es-AR">
      <body>
        <template
          data-design-contract="shadcn-finance-20260821"
          dangerouslySetInnerHTML={{ __html: `<!-- ${designContract} -->` }}
        />
        <PortalShell health={health}>{children}</PortalShell>
      </body>
    </html>
  );
}
