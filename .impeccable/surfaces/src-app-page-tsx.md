---
version: 2
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets:
  [
    "src/app/globals.css",
    "src/app/layout.tsx",
    "src/app/_components/portal-shell.tsx",
    "src/app/_components/app-sidebar.tsx",
  ]
---

# Home

- Scope: inicio operativo del portal y directorio honesto de capacidades.
- Visitor mode: Operate.
- Audience: el owner, inversor argentino, al iniciar una sesión de research o de trading.
- Job: elegir dónde trabajar —Análisis o Trading— o valuar un ticker directamente, sin aprender una interfaz propia.
- Content: una card por sección con una fila por página (ícono, nombre y lo que responde, en una línea), el formulario de valuación arriba de Análisis, verificación (corrida de referencia y diagnóstico) y contrato de evidencia. Sin párrafos ni roadmap: lo planificado no se anuncia (decisión del owner del 2026-11-16).
- Direction: workspace financiero estándar `shadcn-first`; sidebar, header compacto, cards claras, jerarquía corta y bermellón funcional sobre carbón y neutros cálidos; sello torii con velas aprobado el 2026-11-16.
- Memorable moment: el contrato de evidencia resume fuente, fecha, unidad y transformación como parte central del producto.
- Constraints: no simular datos ni capacidades; no leer la base ni Schwab para dibujar el inicio; mobile-first; WCAG 2.2 AA.
- Unresolved: una página nueva entra en `navigation.ts` y en estas filas recién cuando existe.
