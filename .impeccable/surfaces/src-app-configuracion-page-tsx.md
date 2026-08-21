---
version: 1
slug: "src-app-configuracion-page-tsx"
primary_target: "src/app/configuracion/page.tsx"
related_targets:
  [
    "src/app/layout.tsx",
    "src/app/_components/portal-shell.tsx",
    "src/app/globals.css",
  ]
---

# Shell y configuración

- Scope: shell persistente del portal y superficie `/configuracion` para leer salud operativa sin exponer secretos.
- Visitor mode: Operate.
- Audience: el owner al orientarse entre capacidades disponibles y diagnosticar el modo efectivo antes de investigar.
- Job: llegar a una superficie real, distinguir disponibilidad de roadmap y entender qué configuración requiere atención.
- Content: wordmark, modo efectivo, navegación a Inicio y Configuración, estados `ready | degraded | disabled | planned`, detalle seguro de health y límites del slice.
- Direction: Mesa de calibración extendida como marco operativo; navegación compacta, registros lineales y estados inline, sin convertir el rail de la home en plantilla universal.
- Memorable moment: una banda de disponibilidad resume los cuatro estados y conduce al registro de diagnóstico sin depender del color.
- Constraints: sólo enlazar rutas existentes; cero DB, red, ingesta o mutación; foco visible, mobile-first, reflow y feedback conservado con reduced motion.
- Unresolved: incorporar nuevas rutas a la navegación únicamente cuando su slice alcance el gate correspondiente.
