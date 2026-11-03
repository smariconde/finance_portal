# ADR 0066: transformaciones a pesos constantes y a dólares de las series del BCRA

- Estado: aceptado
- Fecha: 2026-11-03
- Alcance: `F9-02`. Decide qué series monetarias se transforman, con qué
  referencia, cómo se alinean las fechas y cómo una transformación se vuelve
  auditable sin guardarse.
- Decisiones relacionadas: [ADR 0003](0003-decimal-arithmetic-valuation-engine.md)
  (aritmética decimal), [ADR 0012](0012-stock-splits-share-basis.md) (un ajuste
  es una política de lectura), [ADR 0065](0065-bcra-monetary-catalog-vintages.md)
  (catálogo, vintages y base fijada por serie)

## Contexto

La `F9-01` dejó 35 series del BCRA con su historia completa y su base fijada.
El objetivo del owner es comparar épocas y gobiernos, y para eso las series en
moneda necesitan una vara común: pesos constantes o dólares. Se midió sobre los
datos de producción el 2026-11-03.

**Qué hay en pesos.** Diez de las 35 están `En millones de ARS`: base
monetaria, circulación, billetes en poder del público, efectivo en entidades,
cuentas corrientes en el BCRA (todas `ML`), y depósitos y préstamos (cinco,
`MEyML`). El resto son tasas, índices, porcentajes, tipos de cambio o reservas
en dólares.

**Referencias.** La inflación mensual (variable 27) va de 1943-02 a hoy, densa,
con un decimal. El CER (30) es diario, todos los días corridos, desde
2002-02-02. El mayorista (5) es diario hábil desde 2002-03-04.

**El CER va atrasado.** Contra el IPC encadenado desde la inflación mensual:

| Ventana           | IPC encadenado | CER del mismo día | CER 45 días después |
| ----------------- | -------------- | ----------------- | ------------------- |
| 2016-09 → 2026-09 | ×131,30        | ×129,48           | ×131,47             |
| 2019-12 → 2023-12 | ×12,43         | ×9,89             | ×12,35              |
| 2023-11 → 2024-11 | ×2,66          | ×3,01             | ×2,67               |

Deflactar por el CER del mismo día atrasa la inflación unos 45 días; con
inflación alta, el error del nivel llega a ±20 %.

**El dólar el mismo día alcanza.** De 6.049 fechas de base monetaria desde
2002-03-04, sólo 5 no tienen mayorista ese día (el feriado cambiario de abril
de 2002). El último dato de cada mes de un stock cae, como mucho, cuatro días
antes de fin de mes.

## Decisión 1 — qué se transforma

`transformationEligibility` decide sobre la base fijada de la serie:

- `En millones de ARS` y `ML`: real por IPC, real por CER y dólares;
- `En millones de ARS` y `MEyML`: **sólo dólares**. Incluyen moneda extranjera
  ya valuada en pesos, así que deflactarlas haría pasar una devaluación por
  crecimiento real (`includes_foreign_currency`, decisión del owner);
- cualquier otra unidad: `not_peso_amount`. Las tasas reales quedan para otro
  slice (decisión del owner).

La base de una serie no cambia sin que el registro la rechace (ADR 0065), así
que la regla por unidad no se mueve sola. Las referencias también tienen su base
fijada en código (`TRANSFORMATION_REFERENCE_BASES`); una referencia con otra
base es `reference_basis_unexpected`, nunca una deflación con otra unidad.

## Decisión 2 — IPC encadenado por defecto, CER como alternativa

Decisión del owner. `bcra-cpi-chain-1.0.0` encadena la inflación mensual
publicada, `I(m) = Π (1 + π_k / 100)`. El nivel es arbitrario y sólo se usan
cocientes. Un mes que falta abre un tramo nuevo en vez de interpolarse, y dos
tramos no se comparan (`reference_gap`).

```text
real_cpi(m)      = nominal(m) × I(base) / I(m)
real_cer(t)      = nominal(t) × CER(base) / CER(t)
usd_wholesale(t) = nominal(t) / mayorista(t)
```

- `real_cpi` es mensual: `nominal(m)` es el último punto de la serie en el mes,
  el stock a fin de mes que el IPC de ese mes deflacta. La base por defecto es
  el último mes con inflación publicada al corte; se puede declarar otra.
- `real_cer` es diario, con el CER del mismo día. La base por defecto es el
  último CER visible hasta la fecha efectiva; los publicados por adelantado no
  entran (ADR 0065). Lleva siempre la advertencia `cer_lags_cpi`.
- `usd_wholesale` divide por el mayorista del mismo día. Un día sin mayorista es
  `null` con motivo, nunca el valor de otro día.

Cada punto que no se puede transformar es `null` con un motivo:
`before_reference_history`, `reference_not_published` o `reference_gap`. Un
nominal negativo conserva su signo y un cero queda en cero. Una referencia en
cero o negativa, o una inflación de −100 % o menos, es un error del contrato
(`non_positive_reference`), no un dato faltante.

## Decisión 3 — lecturas, nunca datos

`macro-transform-1.0.0` se calcula al leer (`readTransformedMacroSeries`) y no
se guarda: no hay migración. La serie nominal y su referencia se leen con **el
mismo** corte, así que una inflación publicada después del `knownAt` nunca
deflacta un punto que se conocía antes, y el mes que todavía no tiene IPC queda
`reference_not_published`. Cada punto lleva su nominal y la fecha de la
referencia que lo transformó, y el resultado publica las **fechas propias** de
cada serie (primera y última) en vez de una fecha común inventada.

## Decisión 4 — auditable

- `cpi-chain-reconciliation-1.0.0` concilia la cadena con la inflación
  interanual que publica la misma fuente (variable 28): doce meses encadenados
  tienen que dar el interanual. Medido: 992 meses, desvío del nivel con mediana
  0,07 % y máximo 0,43 %, que es el redondeo a un decimal acumulado en doce
  meses. La tolerancia queda en 0,5 %, y un mes por encima se nombra.
- `declared-transformation-caveats-1.0.0` nombra, con su fuente, los tramos en
  que una referencia no mide lo que su nombre promete: el IPC del INDEC
  intervenido entre 2007 y 2015 (Decreto 55/2016), los IPC provinciales de
  noviembre 2015 a abril 2016 (metodología del BCRA), los dos cepos cambiarios
  en que el mayorista oficial quedó debajo del mercado, el redondeo de la
  inflación y el rezago del CER. No corrigen nada: se leen.
- `pnpm macro:transform` imprime cada transformación con su versión, unidad,
  fechas propias, motivos por punto, la conciliación y las advertencias. Sólo
  lee la base.

## Consecuencias

- Medido en producción: la base monetaria real tiene 369 meses (1996-01 a
  2026-09) en pesos de 2026-09, y octubre queda `reference_not_published`; en
  dólares, 6.044 días, 1.541 anteriores al mayorista y 5 sin mayorista ese día.
- Depósitos y préstamos sólo se leen en dólares. Un real de esas series exigiría
  separar la moneda extranjera, que el catálogo publica en otras variables.
- Las épocas de cepo quedan en dólares oficiales con su advertencia. Los
  tipos de cambio alternativos son de `F9-03`.
- No hay desestacionalización. La base monetaria tiene estacionalidad (sube
  en diciembre), pero un ajuste propio sería un modelo, no una transformación,
  y la masterplan prohíbe que una serie desestacionalizada reemplace a la
  original en silencio. Queda para el bloque de actividad (`F9-04`), con las
  series desestacionalizadas que publique la fuente.
