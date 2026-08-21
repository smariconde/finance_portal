import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Portal Financiero",
  description: "Análisis financiero personal, reproducible y trazable.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
