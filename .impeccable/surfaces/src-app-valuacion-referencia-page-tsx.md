---
version: 2
slug: "src-app-valuacion-referencia-page-tsx"
primary_target: "src/app/valuacion/referencia/page.tsx"
related_targets:
  [
    "src/app/valuacion/referencia/_components/run-headline.tsx",
    "src/app/valuacion/referencia/_components/evidence-table.tsx",
    "src/app/valuacion/referencia/_components/assumptions-tables.tsx",
    "src/app/valuacion/referencia/_components/equity-bridge-table.tsx",
    "src/app/valuacion/referencia/_components/sensitivity-matrix.tsx",
    "src/app/valuacion/referencia/_components/data-marks.tsx",
    "src/app/_components/app-sidebar.tsx",
  ]
---

# Valuación demo

- Scope: la única corrida de valuación que el portal puede mostrar hoy, con toda su evidencia.
- Visitor mode: Operate.
- Audience: el owner auditando si el resultado del motor FCFF es defendible.
- Job: leer el valor por acción y poder responder, sin salir de la página, de qué hecho salió, cuándo fue conocible, qué se supuso y qué pasa si los supuestos cambian.
- Content: resultado y reproducibilidad, contrato point-in-time, hechos reportados con freshness, ausencias declaradas, supuestos, proyección y descuento, puente EV-equity, sensibilidad WACC/g, corte de conocimiento alternativo, transformaciones, policy checks y límites.
- Direction: extensión del workspace shadcn/Base UI ya fijado; la página es una cadena de evidencia leída de arriba hacia abajo, no un dashboard de tarjetas equivalentes.
- Memorable moment: la fila del corte de conocimiento alternativo, donde el mismo modelo con otro `known_at` produce otro valor y otro hash en vez de corregir el anterior.
- Constraints: `FixtureCo` es sintética y se declara como tal; sin recomendación ni precio objetivo; sin datos live, red ni persistencia personal; el render es determinista (reloj e ID inyectados); WCAG 2.2 AA, teclado y reflow mobile; cada celda rechazada de la sensibilidad conserva su motivo.
- Unresolved: bear/base/bull como conjuntos coherentes de supuestos, workbench editable y selector de método pertenecen a Fase 4; la superficie sólo los nombra como planificados.
