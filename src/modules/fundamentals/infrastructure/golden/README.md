# Corpus congelado de la SEC

Extractos reales de EDGAR, congelados como oráculo de regresión de los parsers de
la SEC. No es una copia de EDGAR ni un recording de una corrida: es un extracto
elegido y reducido, y cada archivo dice en `manifest.json` de qué URL salió, en
qué instante, cuánto pesaba entero y qué hash tenía.

**Fuente:** U.S. Securities and Exchange Commission, EDGAR
(<https://www.sec.gov/edgar>). Contenido público copiado con cita. No se usan el
sello, los logos ni el artwork de la SEC, y nada acá implica afiliación con ella
ni su respaldo.

Qué conserva y qué tira lo decide
[`reduce-sec-corpus.ts`](../../domain/reduce-sec-corpus.ts), por versión declarada.
Los derechos que lo permiten están revisados en la
[ADR 0023](../../../../../docs/architecture/adr/0023-frozen-sec-extracts-rights.md).

Estos archivos **no se editan a mano** y Prettier no los toca: están fijados por
`sha256` en el manifiesto y un test los verifica. Actualizarlos es volver a correr
`pnpm fixtures:capture --apply` y revisar el diff.
