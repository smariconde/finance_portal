---
version: 3
slug: "src-app-valuacion-page-tsx"
primary_target: "src/app/valuacion/page.tsx"
related_targets:
  [
    "src/app/valuacion/_components/valuation-request-form.tsx",
    "src/app/valuacion/_components/valued-companies.tsx",
    "src/app/valuacion/_components/valued-companies-table.tsx",
    "src/app/valuacion/actions.ts",
    "src/app/_components/app-sidebar.tsx",
  ]
---

# Valuación por ticker

- Scope: la entrada de la valuación. Encola y lleva a `/valuacion/[ticker]`, que sigue el pedido en el lugar y muestra el resultado; un pedido que no se pudo hacer se dice acá, sin navegar (`F6-12`).
- Visitor mode: Operate.
- Audience: el owner, pidiendo una empresa del universo constituido o volviendo a una que ya valuó.
- Job: escribir un símbolo y valuar, o abrir lo ya valuado sabiendo de un vistazo cuánto paga el mercado frente al modelo.
- Content (2026-11-16, decisión del owner): encabezado con una línea y su ⓘ, el formulario, la lista de **empresas valuadas** y el enlace a la corrida de referencia. La lista es la última corrida de cada empresa (`valued-companies-1.0.0`, cualquier estado): marca, nombre (`displayCompanyName`) y ticker con enlace, price/value, value per share, precio al `as_of` de esa corrida (`market-price-comparison-1.0.0`, la misma regla que el ticker; un banco usa la regla financiera de `F6-20`), estado como data mark (Calculada, Requiere revisión, Rechazada), método en palabras y fecha. Ordenable por empresa, price/value y fecha (`aria-sort`); lo que no tiene la cifra va al final y dice por qué en dos palabras, nunca cero.
- Direction: el mismo workspace que `/sectores`. Una columna: formulario arriba, tabla debajo. Sin tarjetas ni hero. Price/value primero entre las cifras, porque es lo que se compara.
- Constraints: la lista lee la base en su propio `Suspense` —corridas, grafo y precios guardados—, sin red, sin encolar y sin recalcular; si la base no responde, el formulario sigue en pie y la lista dice «Lista no disponible» (el gate E2E apunta a un puerto cerrado y espera el campo «Ticker»). Un runtime trabado niega la página; el ticker inválido no se repite en el error; no hay precio objetivo ni recomendación; sin IDs internos en el HTML ni en el payload.
- Unresolved: la lista no filtra ni pagina; crece con lo que el owner valúa (no hay valuación por lote).
