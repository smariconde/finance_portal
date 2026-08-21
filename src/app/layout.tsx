import "@fontsource-variable/archivo";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Portal Financiero",
  description: "Análisis financiero personal, reproducible y trazable.",
};

const designContract = `
THESIS: El portal funciona como una mesa de medición donde cada cifra conserva su evidencia; rechaza el dashboard de tarjetas intercambiables.
OWN-WORLD: Papel mineral, tinta petróleo, azul federal y amarillo señal; reglas precisas, placas planas, estados inline y numerales tabulares.
STORY: El owner elige una pregunta, reconoce el alcance disponible y entra al recorrido apropiado sin confundir planes con datos reales.
FIRST VIEWPORT: Un rail calibrado ocupa el margen; una tesis amplia y una entrada de análisis comparten la cabecera; el registro de herramientas continúa sin card grid.
FORM: Mesa de calibración, posición 4 de la exploración, seed fe67c6ea.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
`.trim();

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>
        <template
          data-design-contract="fe67c6ea"
          dangerouslySetInnerHTML={{ __html: `<!-- ${designContract} -->` }}
        />
        {children}
      </body>
    </html>
  );
}
