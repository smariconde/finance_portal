# ADR 0063: crecimiento y pérdidas desde la corrida por ticker

- Estado: aceptado; implementación de `F6-21` en validación
- Fecha: 2026-10-28
- Alcance: `F6-21`, sobre el motor experimental de la
  [ADR 0043](0043-revenue-margin-survival.md)

## Contexto

`growth-fcff-1.0.0` calcula y reproduce snapshots privados, pero la corrida por
ticker no los arma. El selector clasifica MU como `high_growth`; antes de la
ingesta local de este slice no tenía SIC ni fundamentals guardados. La ingesta
SEC de MU publicó 1.120 observaciones desde su 10-K 2026, sin payload crudo.
La evaluación offline aún necesita el SIC para resolver industria y costo de
capital. Su ejercicio 2026 reporta ventas de USD 133.188 millones y EBIT de
USD 99.340 millones, frente a USD 37.378 y 9.770 millones en 2025. Una regla
que perpetúe ese salto no es una trayectoria sostenible.

El motor exige un margen objetivo comparable al EBIT ajustado y un saldo de
pérdidas fiscales con documento, moneda, fecha y límite de compensación. El
[10-K 2026 de MU](https://www.sec.gov/Archives/edgar/data/723125/000072312526000023/mu-20260903.htm)
informa USD 1.680 millones de pérdidas fiscales, USD 1.460 millones en
Malasia sin vencimiento y el resto con vencimientos entre 2027 y 2046. La
partida de activos fiscales diferidos mezcla pérdidas y créditos fiscales. Ni
esa partida ni el total bruto sirven como un pool único de EBIT utilizable.

## Fuente para el margen

La página [Operating and Net Margins de Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/margin.html)
publica por industria el margen operativo **antes de impuestos, ajustado por
arrendamientos e I+D**. Es la columna comparable con la normalización de la
corrida. El owner autorizó agregar exactamente `margin.html` a la allowlist y al
registro de la fuente `damodaran-current-data`; no se amplía el host ni se
guarda la página. El parser exige todos los encabezados en orden, pero publica
sólo `firms` y `pretax_lease_rd_adjusted_margin` por industria y release. Un
margen `null`, no positivo o superior a uno no da objetivo. La disponibilidad
es la observación de la release, como en la ADR 0032; su etiqueta «January
2026» no adelanta esa disponibilidad. Continúa el tope de 20 solicitudes por
día y el kill switch en PostgreSQL. El 2026-10-28 se registró la primera
release con 96 filas, cero rechazadas y una solicitud medida; el HTML no se
guardó.

## Condiciones para la regla derivada

- `high_growth` usa `fcff_three_stage`; `loss_making` usa
  `revenue_margin_survival`. El método y el perfil se vuelven a seleccionar
  desde evidencia fechada, y toda corrida calculada conserva
  `requires_review`.
- `derived-growth-trajectory-1.0.0`, aprobado por el owner: cuatro cierres
  anuales positivos y consecutivos dan el CAGR de ventas de los últimos tres
  años; la tasa inicial es el menor entre ese CAGR y 30 %. Se proyectan diez
  años explícitos, tres a la tasa inicial y una caída lineal hasta la tasa
  terminal durante los siete restantes. El margen converge linealmente al de
  la industria en cinco años. Si el CAGR queda por debajo de la tasa terminal,
  la corrida nombra el faltante y no cambia la regla en silencio.
- El margen objetivo sale de la industria mapeada y de la release visible al
  corte; su clave, campo, valor, disponibilidad y release quedan congelados
  para replay. Sin industria unívoca o margen válido, la corrida nombra el
  faltante.
- La probabilidad de fracaso sale de la tabla de rating sintético o de una
  declaración fechada ya admitida por la ADR 0040. Una probabilidad ausente
  no equivale a cero.
- Por decisión del owner, el saldo de pérdidas compensables se toma sólo de una nota fiscal
  conciliable al cierre base. El monto y las reglas de uso deben cubrir la
  misma base fiscal que los impuestos del modelo. Sin esa evidencia, la
  corrida se niega con un motivo; no inventa saldo cero ni aplica el total
  de otras jurisdicciones.
- `growth-tax-evidence-1.0.0` es deliberadamente estrecha: acepta un único
  saldo federal estadounidense no vencido, con monto, unidad y límite anual
  explícitos en el 10-K conocido al corte. Rechaza partidas entre países o
  estados, vencimientos, múltiples menciones o un límite no publicado. Congela
  sólo el hecho monetario, el documento SEC, su disponibilidad y la regla de
  uso; no persiste el HTML. El extracto reducido del 10-K 2026 de MU está
  fijado por bytes y SHA-256 en `tests/fixtures/sec/`; reproduce la negativa
  por sus USD 1.460 millones en Malasia y el resto con vencimientos.
- El acceso futuro a financiación es una hipótesis de screening expresamente
  nombrada, no una afirmación sobre una línea de crédito. El motor muestra
  la máxima necesidad de fondos y deja la corrida `requires_review`.

El job selecciona `fcff_three_stage` o `revenue_margin_survival`, toma el
margen de la release visible y lee hasta dos recursos SEC por el egress medido
para la nota fiscal. Cada ausencia queda como `snapshotGap`; la restricción de
PostgreSQL se amplía con la migración `0040`. La página muestra la trayectoria,
necesidad de fondos, probabilidad de fracaso, impuestos y procedencia en la
jerarquía actual de la valuación. Snapshots y hashes anteriores se conservan.
La preparación real de MU se negó por `growth_tax_jurisdictions_not_reconciled`
y el job quedó completado con ese motivo, sin corrida ni número inventado.

## Gate de este slice

Una corrida real de cada método, o una negativa justificada por evidencia
faltante, debe quedar auditada y ser reproducible sin red. El selector, el
snapshot, las fuentes y el render se prueban al mismo corte; la UI nombra el
rigor experimental y las ausencias. Antes de cerrar, pasan unit, integración,
build y E2E con axe, y se revisan desktop y 390 px.
