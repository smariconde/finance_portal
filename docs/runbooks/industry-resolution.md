# Resolución de industria con la capa IA

- Slice: `F5-03` (y `F5-06` para este caso)
- Decisión: [ADR 0033](../architecture/adr/0033-ai-layer-industry-resolution.md)
- Runtime: personal, con PostgreSQL, `SEC_USER_AGENT` y `OPENROUTER_API_KEY`
- Relacionado: [gasto de la capa IA](ai-spend.md)

Sin industria no hay beta, y sin beta no hay costo de capital. Cuando el SIC de
una empresa nombra varias industrias de Damodaran (`ambiguous`), este comando le
pregunta a la escalera de modelos cuál es, con evidencia del 10-K, y guarda la
respuesta. Valuar o evaluar después lee lo guardado y nunca vuelve a llamar al
modelo.

## Correr

```sh
pnpm valuation:assess --ticker GOOGL --apply                # antes: registra el SIC observado
pnpm valuation:resolve-industry --ticker GOOGL              # pregunta y reporta, no escribe (sí gasta)
pnpm valuation:resolve-industry --ticker GOOGL --apply      # también guarda la resolución
pnpm valuation:resolve-industry --ticker GOOGL --again --apply
```

Conviene usar `--apply` directamente: el dry run paga la misma llamada y no deja
nada. Varias `--ticker` corren en una sola corrida, con un breaker compartido. Un
freno de la corrida (breaker, clave o cuota) corta antes de pasar a la empresa
siguiente.

## Qué hace, en orden

1. **Decide si hace falta preguntar.** Sin SIC visible, con un SIC de una sola
   candidata o sin fila, o con una declaración del owner, no pregunta. Tampoco
   si la última vez se preguntó por el **mismo SIC y el mismo 10-K**
   (`already_asked`), salvo con `--again`. Saltear cuesta una request a la SEC
   (`submissions`) y nada de IA.
2. **Localiza el último 10-K al corte** (`sec-annual-report-locator-1.0.0`): el
   `10-K` original con la aceptación más reciente, nunca una enmienda. Si el CIK
   vigente no tiene uno —una sucesión reciente—, lo busca en los antecesores
   declarados.
3. **Recorta las secciones dirigidas** (`sec-10k-sections-1.0.0`): el Item 1
   (hasta 20 KB) y la nota de segmentos (hasta 8 KB). Nunca el documento entero.
4. **Comprueba `aiTransfer`** (`ai-transfer-1.0.0`) de cada fuente de la
   evidencia antes de reservar un centavo. Hoy sólo viaja `sec-edgar`.
5. **Corre la escalera** con `industry-resolution-1.0.0`. La evidencia va
   delimitada y marcada como no confiable, y el modelo no tiene herramientas. La
   policy rechaza una industria que no sea candidata o que no esté en la release
   de betas, una respuesta sin citas o con citas desconocidas, y trata la
   confianza `low` como una abstención.
6. **Guarda** en `industry_resolutions` (migración `0025`) toda respuesta
   —resuelta, abstenida o frenada— con sus extractos, su hash y el 10-K del que
   salieron. Sólo una resuelta se publica como aserción `damodaran-industry`,
   disponible desde el instante en que se resolvió. El costo está en
   `ai_spend_ledger`, con el mismo id.

## Precedencia

`sic-damodaran-industry-1.1.0`: **owner → IA → SIC**. Una declaración en
`declared-industry-assignments.ts` pisa a la IA en cualquier momento. Una
resolución sólo vale mientras su industria siga siendo candidata del SIC
visible. `valuation:assess` muestra `ai_resolution` junto al modelo que
respondió y las citas.

## Leer la salida

Por empresa: el 10-K usado, los bytes de cada extracto, cada intento con
resultado, modelo, tokens, latencia y costo, y la respuesta con su motivo. Un
`schema_invalid` dice qué falló sin mostrar el texto del modelo: `not_json|length`
es que el modelo se quedó sin tokens razonando; `industryKey:custom`, que la
salida era incoherente (por ejemplo, resolvió sin clave).

## Medido el 2026-10-15

Sobre las 16 ambiguas de la muestra del gate: **16 resueltas, 0 abstenidas**.
Costaron USD 0,041 en total. 9 resolvió el escalón 1 y 7 el escalón 2; ninguna
llegó al 3. Ocho empresas no financieras ganaron WACC. CRM sigue sin WACC, pero
por la cobertura de intereses y no por la industria. Las siete financieras
tienen industria y siguen sin WACC a propósito: se valúan sobre el equity.
