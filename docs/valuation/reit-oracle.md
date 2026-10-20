# Referencia independiente de AFFO y NAV inmobiliario

- Fecha: 2026-10-20
- Slice: `F4-06 / 4.4`, estado `experimental`
- Decisión: [ADR 0044](../architecture/adr/0044-reit-affo-nav.md)
- Tests: `src/modules/valuation/domain/reit-oracle.test.ts`

## Libro y procedimiento

Se descargó [reval.xls](https://pages.stern.nyu.edu/~adamodar/pc/reval.xls),
enlazado por el [catálogo de Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm),
a `/tmp`. SHA-256 del original:
`a425f355af7d9d674c3f28f06036f9e4fe1a4293349a2bdbb686e33b43e72144`.
LibreOffice lo convirtió a XLSX para inspeccionar fórmulas y resultados.
El libro queda fuera del repositorio. Los tests transcriben números esperados,
sin red, provider nuevo ni captura de datos del owner.

## Conciliación del flujo de equity

Hoja `Equity valuation`, columnas C–G. Fila 26: beneficio después de interés e
impuestos; 27: depreciación inmobiliaria; 28: mantenimiento y mejoras; 29: caja
de equity. La depreciación es 2.000.000 en los cinco años. El subtotal NI + D&A
es el FFO simplificado del caso, sin ventas, deterioros o JV:

| Año |        NI, fila 26 | Mantenimiento, fila 28 | Caja equity, fila 29 |
| --- | -----------------: | ---------------------: | -------------------: |
| 1   |  709.047,572890916 |              1.545.000 |   1.164.047,57289092 |
| 2   |  898.737,627256306 |              1.591.350 |   1.307.387,62725631 |
| 3   | 1.094.831,00581709 |            1.639.090,5 |   1.455.740,50581709 |
| 4   | 1.297.534,04622699 |          1.688.263,215 |   1.609.270,83122699 |
| 5   | 1.507.059,41777721 |        1.738.911,11145 |   1.768.148,30632721 |

Subtotal y caja coinciden a USD `0,0000001`. El costo de equity de la fila 32
también coincide exactamente: `0.054 + 1.1966 × 0.04 = 0.101864`.
Esto prueba la conciliación de caja, no la admisión de un REIT real.

## Capitalización inmobiliaria

En la cuarta hoja, `Comparable Properties`, G10 = 13,3396058855002 es el múltiplo promedio
precio/NOI. E11 = 6.107.405 es el NOI del ejemplo. B16 multiplica ambos y da
81.470.375,6831332. Se reproduce el valor de propiedades con el cap rate
recíproco `1 / 13.3396058855002`, dentro de USD `0,000001`.
El test contrasta la aritmética de capitalización; no declara forward a ese
NOI histórico ni toma ese múltiplo como una tasa de mercado actual.

Diferencias de convención:

- El libro valúa un inmueble corporativo con impuestos y deuda balloon. Su
  terminal de equity resta la deuda del valor del inmueble. El portal proyecta
  AFFO común y descuenta distribuciones sostenibles, sin volver a restar deuda.
  No se afirma igualdad del DCF total entre ambos.
- El portal separa reinversión de crecimiento del mantenimiento ya deducido;
  la conciliación de la tabla aísla únicamente el núcleo común de caja.
- NAV usa NOI forward declarado y cap rate compatible, claims consolidados,
  costo corporativo y opciones. El ejemplo del libro sólo contrasta propiedades.
- La receta AFFO del proyecto no sustituye ni certifica una definición del emisor.

## Segundo oráculo: perpetuidad financiada

Fixture: AFFO base 10, crecimiento constante 2 %, retorno de equity nuevo 12 %
y Ke 10 %. Retención `2/12 = 1/6`; la distribución del primer año es 8,5.

```text
equity = 8,5 / (0,10 - 0,02) = 106,25
value_per_share = 106,25 / 10 = 10,625
```

El motor coincide a `1e-27` para horizontes explícitos de 1, 2, 5, 10 y 20 años.
Si el retorno de equity nuevo es Ke, el múltiplo de AFFO **forward** es `1 / Ke`:
no se confunde con el múltiplo de AFFO histórico. La prueba recorre cuatro tasas
de crecimiento. Un test separado verifica que la reinversión del año actual
financie el crecimiento del siguiente, incluido el paso al terminal.
