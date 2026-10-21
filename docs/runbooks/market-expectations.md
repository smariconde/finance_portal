# Lectura de expectativas del 10-K con la capa IA

- Slice: `F6-11`
- Decisión: [ADR 0050](../architecture/adr/0050-market-expectations-reading.md)
- Runtime: personal, con PostgreSQL, `SEC_USER_AGENT` y `OPENROUTER_API_KEY`
- Relacionado: [gasto de la capa IA](ai-spend.md),
  [mix de operaciones](operations-mix.md)

`/valuacion/[ticker]` muestra lo que exige el precio de cada supuesto
(`F6-09`). Este comando le pide a la escalera de modelos que lea el último
10-K y diga qué perspectiva sostiene la evidencia sobre el crecimiento, el
margen y la ventaja competitiva, con señales citadas. El modelo **no ve el
precio ni lo exigido**. La página pone la lectura al lado de lo exigido y el
código dice a cuántos escalones queda.

## Antes

```sh
pnpm fundamentals:ingest --ticker AAPL --apply    # fecha el ejercicio del 10-K
```

## Correr

```sh
pnpm valuation:market-expectations --ticker AAPL              # pregunta y reporta, no escribe (sí gasta)
pnpm valuation:market-expectations --ticker AAPL --apply      # también guarda la lectura
pnpm valuation:market-expectations --ticker AAPL --again --apply
```

Conviene usar `--apply` directamente: el dry run paga la misma llamada y no
deja nada. Por empresa son dos requests a la SEC (`submissions` y el 10-K) y la
escalera, con el tope de USD 0,10 por tarea.

## Qué hace, en orden

1. **Decide si hace falta preguntar.** No pregunta en estos casos, cada uno
   con su motivo:
   - no hay 10-K al corte (`no_annual_report`);
   - los fundamentals no fechan su ejercicio (`fiscal_year_unknown`);
   - no se encuentra ni el Item 1 ni el MD&A
     (`outlook_sections_not_found`);
   - ya se preguntó por el mismo 10-K con la misma tarea, prompt y policy
     (`already_asked`). `--again` fuerza la pregunta.
2. **Recorta** el Item 1 (8 KB), el MD&A sin sus subsecciones de
   advertencias, contabilidad y liquidez (18 KB) y el comienzo del Item 1A
   (4 KB) con `sec-10k-outlook-1.0.0`.
3. **Corre la escalera.** La policy rechaza:
   - una cita que no está en su bloque;
   - una cifra del resumen que no está en ese bloque;
   - un driver repetido o faltante;
   - una perspectiva de otra escala.

   Confianza baja es abstención.

4. **Guarda** con `--apply` la lectura, la abstención o el freno, con las
   secciones enviadas y sus `sha256`.

## Qué mirar después

La página de la corrida cuyo año base es el ejercicio del 10-K muestra
«Lo que sostiene el 10-K». La columna dice «dentro», «un escalón por encima»
o «dos o más» para cada supuesto. Una lectura de otro ejercicio no aparece:
se pide de nuevo después de ingerir el 10-K nuevo.
