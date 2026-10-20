# ADR 0043: pérdidas y alto crecimiento por ventas, margen y supervivencia

- Estado: aceptado; modelo `experimental`
- Fecha: 2026-10-20
- Alcance: `F4-06`, slice 4.3
- Depende de: ADR 0003, 0038, 0039, 0040 y 0042

## Contexto

El beneficio negativo no admite un CAGR de ganancias ni un múltiplo P/E útil.
Una empresa que crece rápido necesita converger a una operación sostenible;
extrapolar crecimiento alto o un margen de recuperación para siempre la
sobrevalúa. También necesita reinversión y acceso a capital durante las pérdidas.

## Decisión

Se implementan `fcff_three_stage` para `high_growth` y
`revenue_margin_survival` para `loss_making`, con motor y metodología
`growth-fcff-1.0.0`. Comparten el núcleo de descuento, puente, supervivencia y
opciones del FCFF, con contrato propio `revenue-margin-1.0.0`.
Los motores anteriores y sus hashes se conservan.

### Ventas y rentabilidad

El snapshot privado declara crecimiento inicial, años de alto crecimiento `H`,
horizonte explícito `N`, margen sostenible y años hasta alcanzarlo `M`.
`1 <= H < N <= 20` y `1 <= M <= N`. La transición ocupa `N - H` años;
el terminal es la tercera etapa. Las ventas base deben ser positivas y el EBIT
base viene de la normalización recalculada. El método de pérdidas exige EBIT
ajustado negativo; una recuperación ya completada requiere otra selección.

```text
growth[t] = initial_growth                                      si t <= H
            initial_growth + (terminal_g - initial_growth)
                             × (t - H) / (N - H)               si t > H
margin[t] = base_adjusted_margin + (target_margin - base_adjusted_margin)
                                 × min(t / M, 1)
revenue[t] = revenue[t-1] × (1 + growth[t])
reinvestment[t] = (revenue[t] - revenue[t-1]) / sales_to_capital[t]
```

El objetivo de margen está en `(0, 1]`, el crecimiento inicial no es menor que
el estable y el estable no es negativo. El último crecimiento explícito coincide
con el terminal, sujeto al techo de libre de riesgo y al buffer de WACC.
Los períodos son ejercicios anuales, incluidos los de 52/53 semanas.
La tesis de mercado/crecimiento, el margen objetivo y el acceso a financiación
necesitan motivos explícitos. No se infieren de la clasificación ni se pide IA.

### Impuestos y fondos

El saldo de pérdidas compensables del cierre base es un hecho monetario con
fuente, documento, moneda y disponibilidad; `null` bloquea y cero es un saldo
explícito. El snapshot declara el límite de compensación `L` en `[0, 1]` y
por qué el tratamiento simplificado es aplicable durante la proyección.

```text
used[t] = min(opening_loss[t], max(EBIT[t], 0) × L)
taxable[t] = max(EBIT[t], 0) - used[t]
taxes[t] = taxable[t] × tax_rate[t]
closing_loss[t] = opening_loss[t] - used[t] + max(-EBIT[t], 0)
NOPAT[t] = EBIT[t] - taxes[t]
```

No hay devolución inmediata por pérdidas. El saldo inicial ya incluye el
cierre base: el motor no lo suma de nuevo. Cada año conserva saldo inicial,
uso, saldo final, renta imponible e impuestos. Es un pool operativo simplificado,
sin caducidad, cambio de control, créditos ni diferencias por jurisdicción;
no representa un cálculo fiscal estatutario. Una limitación que ese pool no
represente exige otro snapshot/método, no una cifra inferida.

El terminal aplica impuestos normales al EBIT y no perpetúa un escudo fiscal
finito. El saldo remanente se muestra; omitir su uso futuro puede subvalorar.
El resultado muestra `max(0, -min(cumulative_FCFF))` durante la proyección como
pico de necesidad de fondos operativos, antes de caja disponible y financiación.
No es capital asegurado ni un cálculo de runway. El valor ya descuenta todos los
FCFF negativos; no se resta ese pico otra vez. No se simulan emisiones futuras
ni sus términos, y la hipótesis de acceso al capital exige revisión.

La supervivencia usa la probabilidad fechada a diez años y el recupero de la
ADR 0040, una vez antes del puente. No se transforma en una tasa anual ni se
inventa probabilidad cero. Se conserva esa convención aunque `N` sea distinto
de diez. Opciones y unidades de empleados siguen recalculándose una sola vez.

### Escenarios, sensibilidad y admisión

Bear/bull son snapshots completos. `terminalEbitMargin` cambia el objetivo y
reconstruye la trayectoria. `terminalGrowth` reconstruye la transición de ventas;
un driver explícito de crecimiento debe declarar la trayectoria completa que
su crecimiento inicial y terminal derivan. Márgenes por período se rechazan
porque eludirían la convergencia. Impuestos, pérdidas, fracaso y puente se
calculan de nuevo para cada escenario.

La sensibilidad WACC/g conserva el pronóstico explícito y varía sólo descuento
y terminal, como las familias FCFF existentes; no equivale a otro escenario de
crecimiento ni asigna probabilidades. Las celdas inválidas conservan el rechazo.

El selector `method-selection-0.5.0` exige preflight propio y se vuelve a ejecutar
sobre señales fechadas del snapshot. Precedencia, conflictos y perfiles sin
cobertura siguen fallando cerrados. El rigor se limita a `screening`; cada
corrida calculada queda `requires_review`. Se comprueban moneda, cutoff,
versiones, trayectoria y disponibilidad separada de la nota de empleados.
`system_recorded` se rechaza sin fechas de registro por hecho.

`pnpm valuation:growth --file <snapshot-privado.json>` calcula sin red ni IA,
con límite de 512 kB y dry run por defecto. `--apply` exige personal y registra
resultado o rechazo en el repositorio append-only. El replay reproduce ambos
hashes desde el snapshot. Sin migración, nueva fuente, UI ni cambio de ingesta.
Construir automáticamente el snapshot queda para otro incremento.

## Alternativas y consecuencias

- **FCFF maduro como fallback:** omite la transición y permitiría elegir un
  método sin sus requisitos. Sigue prohibido.
- **Convergencia asintótica de `higrowth.xls`:** defendible, pero un horizonte
  finito con objetivo exacto hace explícito cuándo alcanza estabilidad. La
  diferencia se documenta en el oráculo; no se afirma equivalencia total.
- **Cero impuestos o devolución durante pérdidas:** el primero ignora el uso
  finito de quebrantos; la segunda inventa liquidez inmediata.
- **Rigor productivo automático:** ni los supuestos escritos ni la aceptación
  de una fixture prueban tamaño de mercado, financiación o uso fiscal real.

La [referencia independiente](../../valuation/revenue-margin-oracle.md) contrasta
flujos e impuestos de la planilla y una perpetuidad diferida con escudo finito.
Los tests cubren escenarios, sensibilidad, monotonía, bordes, persistencia,
dedupe y replay. Tras guardar corridas, un rollback debe conservar su lector y
motor; nunca borra corridas.

## Fuentes primarias

- [Damodaran, young growth value drivers](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/littlebook/younggrowthvaluedrivers.htm): ventas, margen objetivo, reinversión y supervivencia.
- [Growth value drivers](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/littlebook/growthvaluedrivers.htm): convergencia hacia crecimiento y márgenes sostenibles.
- [Catálogo de planillas](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm) y [higrowth.xls](https://www.stern.nyu.edu/~adamodar/pc/higrowth.xls): contraste independiente, con diferencias de convención declaradas.
