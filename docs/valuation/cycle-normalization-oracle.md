# Referencia independiente de la normalización de ciclo

- Fecha: 2026-10-20
- Slice: `F4-06 / 4.2`, estado `experimental`
- Decisión: [ADR 0042](../architecture/adr/0042-cycle-normalized-fcff.md)
- Tests: `src/modules/valuation/domain/cycle-normalization-oracle.test.ts`

## Libro y procedimiento

Se contrastó la fórmula con la [explicación de Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/normearn.htm)
y el libro [normearn.xls](https://www.stern.nyu.edu/~adamodar/pc/normearn.xls),
enlazado en su [catálogo](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm).
El archivo de investigación existente fuera del repositorio tiene 69.632 bytes,
SHA-256 `1ac40ee0abd3c17c375e024e379c6aa9ac30856a6361731d164150b3aaf73cff`.
Se inspeccionaron las fórmulas y valores de su conversión LibreOffice a XLSX
en un directorio temporal. No es un provider ni una captura de datos personales.
Los tests no leen el libro ni llaman la red.

## Celdas y diferencia de convención

Hoja «Earnings Normalizer & Output», columnas B–F:

| Concepto / fila |             Año −5 |            Año −4 |            Año −3 |            Año −2 |            Año −1 |
| --------------- | -----------------: | ----------------: | ----------------: | ----------------: | ----------------: |
| Revenue, 19     |               2032 |              2376 |              2779 |              3155 |              3248 |
| EBIT, 20        |                186 |               454 |               529 |               448 |               383 |
| Margen, 21      | 0,0915354330708662 | 0,191077441077441 | 0,190356243252969 | 0,141996830427892 | 0,117918719211823 |

Los cinco márgenes coinciden a 14 decimales. El libro calcula G21 como
`SUM(EBIT) / SUM(revenue) = 2000 / 13590 = 0,147167034584253`.
La implementación promedia cada margen anual con igual peso:
`0,14657693340819816`. Se elige explícitamente esa media para que un año de
precios/ventas altos no domine el ciclo; no se afirma que ambas fórmulas sean
iguales ni que el peso sea una decisión de Damodaran.

La venta actual, «Master Inputs Start here» B15, es 12.154. La celda D14 del
normalizador multiplica esa venta por G21 y da 1.788,66813833701. Con la media
anual del portal da 1.781,4960486432405: diferencia −7,1720896937695, explicada
íntegramente por la ponderación. Las expectativas están escritas en el test;
no se generan con el motor que se está probando.

Este contraste verifica el normalizador. No se afirma una equivalencia de todo
el DCF de `normearn.xls`: tiene elecciones propias de leases, I+D, tasas y
reinversión. Tampoco convierte esos datos de la hoja en una valuación vigente.
La historia de la hoja precede a su venta actual; el test aislado del
normalizador reproduce ese mapa. El contrato de una corrida completa exige que
su último año reconcilie con la base, como prueban las fixtures sintéticas.

## Segundo oráculo y bordes

Una fixture independiente usa ventas constantes de 96 millones, margen 10,6 %,
tasa fiscal 25 %, crecimiento y probabilidad de fracaso cero, y WACC 9 %.
Normaliza en el primer año y no reinvierte: la caja perpetua es 7,632 millones.
El EV calculado por proyección y terminal debe ser `7,632 / 0,09 = 84,8 millones`
con tolerancia de USD 0,000001. No depende del libro ni de otra iteración del
mismo algoritmo de DCF.

La fixture del contrato conserva un año con EBIT negativo y verifica que la
media no lo excluye. Al multiplicar ventas y EBIT de cada año por siete, el
margen normalizado no cambia. Los escenarios reconstruyen la convergencia,
la sensibilidad conserva la celda base y las celdas por encima de la libre de
riesgo se rechazan. Un aumento de margen con ventas y financiación fijas sube
el valor. Los tests de persistencia conservan JSON, decimales y hashes exactos,
incluidos los de una corrida rechazada.
