---
version: 2
slug: "src-app-configuracion-page-tsx"
primary_target: "src/app/configuracion/page.tsx"
related_targets:
  [
    "src/app/layout.tsx",
    "src/app/_components/portal-shell.tsx",
    "src/app/_components/app-sidebar.tsx",
    "src/app/globals.css",
  ]
---

# Shell y configuración

- Scope: shell persistente y superficie `/configuracion` para leer salud operativa sin exponer secretos.
- Visitor mode: Operate.
- Audience: el owner al orientarse entre capacidades disponibles y diagnosticar el modo efectivo.
- Job: llegar a una ruta real, distinguir disponibilidad de roadmap y entender qué configuración requiere atención.
- Content: sidebar colapsable, modo efectivo, navegación a Inicio y Configuración, estados `ready | degraded | disabled | planned`, tabla segura de health y límites del slice.
- Direction: workspace financiero estándar `shadcn-first`; tabla semántica, badges explícitos, cards de resumen y contenido operativo sin portada editorial.
- Memorable moment: una guía de estados hace legible la disponibilidad sin depender del color y conduce a la tabla de diagnóstico.
- Constraints: sólo enlazar rutas existentes; cero DB, red, ingesta o mutación; foco visible, mobile-first, scroll tabular y reduced motion.
- Unresolved: incorporar rutas al sidebar únicamente cuando su slice alcance el gate correspondiente.
