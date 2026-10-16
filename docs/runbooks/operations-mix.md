# Mix de operaciones con la capa IA

- Slice: `F5-05` (y `F5-06` para este caso)
- Decisión: [ADR 0034](../architecture/adr/0034-operations-weighted-country-risk.md)
- Runtime: personal, con PostgreSQL, `SEC_USER_AGENT` y `OPENROUTER_API_KEY`
- Relacionado: [gasto de la capa IA](ai-spend.md),
  [resolución de industria](industry-resolution.md)

Damodaran pondera el riesgo país por **dónde opera** la empresa, no por dónde
cotiza. `companyfacts` no trae dimensiones, así que el mix sale de la tabla de
ingresos por geografía del 10-K. Este comando le pide a la escalera de modelos que
la **transcriba** y mapee cada línea a países o regiones de Damodaran; los pesos
los calcula el código y la evaluación lee lo guardado sin volver a llamar al
modelo.

## Antes

```sh
pnpm damodaran:record --dataset damodaran.country-risk --dataset damodaran.country-risk-regions --apply
pnpm fundamentals:ingest --ticker AAPL --apply    # los ingresos del ejercicio son el control de la policy
```

## Correr

```sh
pnpm valuation:operations-mix --ticker AAPL              # pregunta y reporta, no escribe (sí gasta)
pnpm valuation:operations-mix --ticker AAPL --apply      # también guarda la propuesta
pnpm valuation:operations-mix --ticker AAPL --again --apply
```

Conviene usar `--apply` directamente: el dry run paga la misma llamada y no deja
nada. Varias `--ticker` corren en una sola corrida, con un breaker compartido.

## Qué hace, en orden

1. **Decide si hace falta preguntar.** No pregunta si el owner declaró el mix del
   CIK (`declared-operations-mixes.ts`, el lock), si no hay release de riesgo
   país al corte, si no hay 10-K, si no se conocen los ingresos de su ejercicio
   (`revenue_unknown`), si el 10-K no tiene tabla geográfica
   (`geographic_table_not_found`) o si ya se preguntó por el **mismo 10-K con la
   misma tarea, prompt y policy** (`already_asked`), salvo con `--again`.
2. **Recorta la tabla** (`sec-10k-geographic-revenue-1.0.0`, 6 KB).
3. **Comprueba `aiTransfer`** de la SEC antes de reservar.
4. **Corre la escalera** (`operations-mix-1.0.0`, prompt `1.1.0`): al modelo van
   la tabla delimitada como no confiable y las claves de países y regiones por
   nombre; ningún valor de Damodaran ni los ingresos esperados.
5. **La policy decide** (`operations-mix-policy-1.1.0`): cada monto está en su
   cita y cada cita en la evidencia; las líneas suman el total (0,5 %); el total
   es el ingreso del ejercicio (5 %); las claves existen; un nombre coincide con
   la clave, un alias declarado o una lista de ellos; una definición está citada;
   el resto del mundo es una etiqueta de resto.
6. **Guarda** con `--apply` la propuesta —aceptada, abstenida o frenada—, sus
   líneas y su evidencia (migración `0026`).

## Leer el resultado

`pesos` es lo que el costo de capital usará: cada línea geográfica sobre la suma
de las geográficas. Las partidas sin lugar (coberturas, corporativo) no pesan. Una
línea con varias claves se combina por PBI y el resto del mundo con las nueve
regiones, en `cost-of-capital-1.1.0`.

## Medido el 2026-10-16

Sobre las 17 no financieras de la muestra del gate que publican la tabla: **13
aceptadas** —AMZN, CCL, CRL, CRM, F, FCX, INCY, JNJ, MRNA, NCLH, NEM, NVDA y
XOM— por USD 0,40 en dos vueltas. La primera vuelta, con la policy `1.0.0`,
aceptó 10; la `1.1.0` sumó JNJ (etiquetas compuestas), NEM (una raya es cero) y
XOM (tolerancia contra los ingresos). Duke y Devon no publican tabla y no gastan.

Siguen sin mix AAPL, CAT, DE y GOOGL: los escalones 1 y 3 agotan los 6.000 tokens
de salida razonando (`not_json|length`) y el 2 fue rechazado, se abstuvo o no
respondió a tiempo. Subir el techo o cambiar de escalón es una versión nueva de la
tarea o de la escalera, y la decide `F5-07`. Mientras tanto, el owner puede
declarar el mix de cualquiera.

En la base: 24 propuestas (13 aceptadas, 11 abstenidas) ocupan 312 kB.

## Si algo falla

- `revenue_unknown`: falta ingerir fundamentals, o el ejercicio del 10-K no está
  en la serie anual.
- `country_release_missing`: falta registrar las releases de riesgo país.
- Muchas `name_does_not_match`: una etiqueta nueva que merece un alias declarado
  (`EXPOSURE_ALIASES`), en una versión nueva de la policy.
- `stopped`: un freno de la corrida (breaker, clave, cuota o tope de gasto). Ver
  [gasto de la capa IA](ai-spend.md).
