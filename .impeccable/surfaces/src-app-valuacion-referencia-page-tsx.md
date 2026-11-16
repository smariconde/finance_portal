---
version: 4
slug: "src-app-valuacion-referencia-page-tsx"
primary_target: "src/app/valuacion/referencia/page.tsx"
related_targets:
  [
    "src/app/valuacion/_components/run/run-headline.tsx",
    "src/app/valuacion/_components/run/evidence-table.tsx",
    "src/app/valuacion/_components/run/assumptions-tables.tsx",
    "src/app/valuacion/_components/run/equity-bridge-table.tsx",
    "src/app/valuacion/_components/run/sensitivity-matrix.tsx",
    "src/app/valuacion/_components/run/data-marks.tsx",
    "src/app/_components/app-sidebar.tsx",
  ]
---

# Valuación demo

- Scope: la única corrida de valuación que el portal puede mostrar hoy, con toda su evidencia.
- Visitor mode: Operate.
- Audience: el owner auditando si el resultado del motor FCFF es defendible.
- Job: leer el valor por acción y poder responder, sin salir de la página, de qué hecho salió, cuándo fue conocible, qué se supuso y qué pasa si los supuestos cambian.
- Content: resultado y reproducibilidad, contrato point-in-time, hechos reportados con freshness, ausencias declaradas, supuestos, proyección y descuento, puente EV-equity, escenarios bear/base/bull, sensibilidad WACC/g, corte de conocimiento alternativo, transformaciones, policy checks y límites.
- Direction: extensión del workspace shadcn/Base UI ya fijado; la página es una cadena de evidencia leída de arriba hacia abajo, no un dashboard de tarjetas equivalentes.
- Memorable moment: la fila del corte de conocimiento alternativo, donde el mismo modelo con otro `known_at` produce otro valor y otro hash en vez de corregir el anterior.
- Constraints: `FixtureCo` es sintética y se declara como tal; sin recomendación ni precio objetivo; sin datos live, red ni persistencia personal; el render es determinista (reloj e ID inyectados); WCAG 2.2 AA, teclado y reflow mobile; cada celda rechazada de la sensibilidad conserva su motivo.
- Scenarios (`F4-04`): bear/base/bull como tabla semántica de valor por acción con barra anclada en cero redundante con el número, diferencia contra la base, EV, peso del terminal y controles en revisión; debajo, la tesis y los drivers de cada escenario contra el valor de la base, con su motivo. Sin probabilidades.
- Pulido (2026-11-16, preferencia del owner): el encabezado dice en una línea qué prueba la página («una valuación fija que prueba que el motor da siempre el mismo resultado»); FCFF, snapshot, hash y que no usa red ni base pasan al ⓘ. El aviso de empresa sintética es una frase; la identidad lleva su explicación en un ⓘ; las descripciones de las cards compartidas de la corrida son una línea; los cuatro límites se reducen a una línea al pie (sin precio de mercado, recomendación ni señal). Escenarios y sensibilidad heredan el camino año por año y la lectura de la grilla en el ⓘ.
- Unresolved: workbench editable y selector de método pertenecen a Fase 4; la superficie sólo los nombra como planificados.
