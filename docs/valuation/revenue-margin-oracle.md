# Referencia independiente de pérdidas y alto crecimiento

- Fecha: 2026-10-20
- Slice: `F4-06 / 4.3`, estado `experimental`
- Decisión: [ADR 0043](../architecture/adr/0043-revenue-margin-survival.md)
- Tests: `src/modules/valuation/domain/revenue-margin-oracle.test.ts`

## Libro y procedimiento

Se descargó [higrowth.xls](https://www.stern.nyu.edu/~adamodar/pc/higrowth.xls),
enlazado por el [catálogo de Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm),
a `/tmp`, fuera del repositorio. Tamaño: 139.776 bytes. SHA-256:
`ebe341830626c4d1e923564e7b12011c6d3e6f053728ed713706138e005fd3a9`.
Se convirtió a XLSX con LibreOffice y se inspeccionaron fórmulas y resultados.
No se incorpora el libro, un provider ni una captura personal. Los tests usan
valores esperados transcriptos y no abren la red.

## Conciliación del núcleo de caja

Hoja `DCFValuation`, base B3 = 1246,301, quebranto B12 = 1289,
tasa 37,5 % y sales-to-capital 3,02. C–F son los primeros cuatro años:

| Fila / concepto  |             Año 1 |             Año 2 |            Año 3 |            Año 4 |
| ---------------- | ----------------: | ----------------: | ---------------: | ---------------: |
| 3 / Revenue      |        1931,76655 |      2801,0614975 |     3921,4860965 |   5294,006230275 |
| 5 / EBIT         |  61,1726807640448 |  212,248239864719 | 400,927732126364 | 625,314397386355 |
| 6 / Taxes        |                 0 |                 0 |                0 | 3,99864380305588 |
| 12 / Closing NOL |  1227,82731923596 |  1015,57907937124 | 614,651347244872 |                0 |
| 11 / FCFF        | −165,802666918074 | −75,5977692412412 | 29,9262092786819 | 166,838888094888 |

Los veinte valores coinciden con tolerancia absoluta de `5e-9` en las unidades
del libro. El test aísla el núcleo de caja con las trayectorias de esa hoja;
no afirma que ese input pase la admisión del portal ni que reproduzca el DCF
completo del libro.

Diferencias declaradas:

- El libro permite crecimiento por año (55, 45, 40, 35 % al inicio) y margen
  asintótico, con velocidad 1,5. El portal exige una etapa de crecimiento
  constante seguida por transición lineal hasta `g`, y margen lineal que alcanza
  exactamente el objetivo en `M` años.
- La hoja compensa hasta el 100 % del EBIT; el portal lo declara por snapshot.
  El caso transcripto usa 100 % y otro test verifica un límite del 80 %.
- La hoja usa sus propias capitalizaciones, tasas, puente y opciones; el portal
  conserva las ADR 0037–0040. No se compara el valor por acción total como si
  todas esas decisiones fueran las mismas.
- El terminal de ambos aplica impuestos normales, sin perpetuar el saldo finito.

## Segundo oráculo: perpetuidad diferida y escudo finito

Una fixture con ventas constantes de 96 millones y EBIT base −19,2 millones
converge al margen 20 % en dos años: año 1 con margen cero y desde año 2 con
EBIT 19,2 millones. Tasa 25 %, WACC 9 %, crecimiento cero, sin fracaso y
quebranto inicial explícito de 10 millones compensable al 100 %.

Sin crecimiento no hay reinversión. Desde año 2 el FCFF normal es 14,4 millones;
en ese año se agrega el ahorro fiscal único de 2,5 millones. Por una vía cerrada,
independiente del bucle de proyección y terminal:

```text
EV = (14.400.000 / 0,09) / 1,09 + 2.500.000 / 1,09²
   = 148.893.190,8088544735291642117
```

El motor coincide dentro de USD 0,000001. Impuestos del año 2: 2,3 millones;
desde el año 3: 4,8 millones. El saldo remanente es cero. Los tests adicionales
conservan pérdidas proyectadas sin devolución, comprueban el límite anual,
trayectorias, escenarios completos, la celda base de sensibilidad, monotonía,
cutoffs, nulos, cero, negativos, moneda y no finitos. Los contratos PostgreSQL
conservan decimales, rechazos y replay de los dos perfiles.
