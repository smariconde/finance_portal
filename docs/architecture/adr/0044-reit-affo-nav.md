# ADR 0044: REIT de propiedades por AFFO distribuible y NAV

- Estado: aceptado; modelo `experimental`
- Fecha: 2026-10-20
- Alcance: `F4-06`, slice 4.4
- Depende de: ADR 0003, 0039, 0040 y 0041

## Contexto

Un REIT de propiedades no se valúa con el FCFF industrial. La depreciación
inmobiliaria contable difiere del mantenimiento económico; FFO tampoco es caja
disponible para distribuir. AFFO no tiene una definición uniforme. Usar un AFFO
publicado sin su conciliación puede omitir mantenimiento, alquiler no cobrado o
claims de terceros. El valor por propiedades exige su propio puente a equity.

## Decisión

`affo_nav`, motor `affo-nav-1.0.0` y metodología `reit-equity-1.0.0`, tiene un
contrato propio en dominio puro. Admite únicamente `equity_property`; mortgage
y hybrid REITs se rechazan. La clasificación se vuelve a ejecutar con señales
fechadas y preflight propio (`method-selection-0.6.0`), sin fallback industrial.

### Conciliación y caja común

`affo-reconciliation-1.0.0` congela un ejercicio anual de 350–380 días,
con no más de 380 días desde su cierre hasta el `asOf`. Cada componente tiene
moneda, fecha, disponibilidad y documento. Cero es explícito; `null` rechaza.

```text
FFO = common_net_income + real_estate_depreciation - property_sale_gains
      + real_estate_impairments + joint_venture_adjustment
AFFO = FFO - recurring_capex - straight_line_rent
```

El resultado y los ajustes son atribuibles al común: después de interés,
impuestos, preferidas y minoritarios. Depreciación, deterioros y mantenimiento
son no negativos; ganancias de ventas, ajuste de JV y alquiler lineal son
firmados. El ajuste de JV añade sólo el ajuste a FFO de la participación, sin
volver a sumar su resultado. Mantenimiento incluye tenant improvements y
comisiones de leasing. No se añade compensación en acciones. Es una receta
del proyecto, no una certificación de FFO de Nareit ni del AFFO del emisor.
Un caso con ajustes no representables necesita otro contrato; no se altera NI
reportado para hacerlo encajar. AFFO no positivo requiere un modelo de recuperación.

### Crecimiento financiado y descuento

Se declaran crecimiento anual de AFFO, retorno sobre equity nuevo y beta de
equity por período, con motivo. El crecimiento del primer año se apoya en el
capital ya invertido al corte. La retención actual financia el año siguiente:

```text
AFFO[t] = AFFO[t-1] × (1 + growth[t])
funded_growth[t] = growth[t+1]                 si t < N
                  terminal_g                 si t = N
retention[t] = funded_growth[t] / return_on_new_equity[t]
growth_reinvestment[t] = AFFO[t] × retention[t]
distributable_cash[t] = AFFO[t] - growth_reinvestment[t]
Ke[t] = risk_free + equity_beta[t] × mature_ERP + CRP
discount_factor[t] = product(1 + Ke[1..t])
```

El terminal repite la lógica con `AFFO[N+1]`, `g / return_on_new_equity`, y
`cash[N+1] / (Ke_terminal - g)`. Crecimientos no negativos, retornos positivos,
retención en `[0,1]`, Ke positivo, beta no negativa, `g <= rf` y buffer
`Ke > g + 0.005`. El crecimiento no es gratuito. No se resta deuda al DCF de
equity ni se añade caja otra vez: AFFO ya es común, y el pronóstico debe incluir
su rendimiento económico. El modelo supone financiación y apalancamiento
sostenibles; no modela emisiones, amortizaciones de principal o refinanciación.

### NAV independiente

El snapshot declara NOI consolidado de los próximos doce meses, antes de
financiación, y cap rate compatible, ambos como supuestos con evidencia fechada
y motivo; no es el NOI del año actual capitalizado como si fuera forward.

```text
property_value = forward_NOI / cap_rate
gross_common_NAV = property_value + excess_cash + non_property_assets
                   - debt - preferred_equity - noncontrolling_interests
                   - other_liabilities - corporate_cost_value
```

Cap rate en `(0,1]`, NOI positivo y todos los activos/claims no negativos.
El puente usa valores económicos de claims al `asOf`. La evidencia explica
cobertura inmobiliaria, JV no consolidadas, contratos de ground lease y costo
corporativo capitalizado; cada partida entra una vez. Costo corporativo cero
exige que ya esté incluido en NOI o que el caso no lo tenga. NAV negativo se
conserva con revisión, sin llevarlo a cero. Se muestran DCF y NAV por separado,
con diferencia monetaria por acción; no se promedian ni se presentan como EV.

Las opciones se recalculan desde la nota congelada y se restan una sola vez de
cada equity; básicas más unidades no consolidadas forman el denominador común.
Las opciones no se suman al denominador (ADR 0040).

### Escenarios, controles y ejecución

Bear/bull son snapshots completos de supuestos con el mismo horizonte anual
y cambios económicos, no sólo etiquetas. DCF y NAV tienen checks de orden
independientes. Sensibilidad beta terminal/g: mantiene la trayectoria de AFFO,
recalcula el último año de retención para financiar el nuevo `g` y el terminal;
no modifica betas explícitas. Otra sensibilidad cambia cap rate del NAV.
Celdas inválidas conservan sus motivos. No se asignan probabilidades.

Estado `experimental`, rigor `screening`, siempre `requires_review`. Se revisan
definición AFFO, mantenimiento, financiación, leverage, distribución fiscal,
NOI, cap rates y cobertura; no se infiere que AFFO sea ingreso imponible ni que
cumpla una obligación legal de distribución. `system_recorded` se rechaza sin
fecha de registro por hecho; acciones y claims NAV deben coincidir con el
`asOf`. La nota de empleados tiene disponibilidad separada. Moneda, documentos,
cutoff y versiones se validan antes del cálculo (`TM-05`, `TM-06`, `TM-15`).

`pnpm valuation:reit --file <snapshot-privado.json>` es CLI local sin red ni IA,
limitada a 512 kB, dry run salvo `--apply`. El guard personal se aplica antes
de construir storage; se persisten también rechazos (`TM-01`, `TM-16`).
`valuation_runs` admite la familia por su contrato JSON, sin migración;
`valuation:replay` reproduce sus hashes sin releer datos o llamar modelos.
No se agrega UI ni construcción automática del snapshot.

## Alternativas y consecuencias

- **FCFF industrial:** omite la conciliación inmobiliaria y confunde deuda con
  flujos ya financiados. Sigue excluido.
- **AFFO como dividendo perpetuo sin reinversión:** sobrevalúa el crecimiento.
  La retención económica es independiente del porcentaje legal de distribución.
- **Sólo NAV o promedio DCF/NAV:** oculta diferencias de financiación, costos
  corporativos y supuestos de mercado. Se conservan ambas lecturas.
- **Copiar el AFFO publicado:** no permite auditar su definición; la receta
  explícita limita cobertura, deliberadamente.

El [oráculo independiente](../../valuation/reit-oracle.md) compara caja de
equity y capitalización de `reval.xls`, con diferencias declaradas, y una
perpetuidad de crecimiento financiado. Tests de bordes, escenarios, sensibilidad,
opciones, persistencia y replay. Un rollback conserva el lector y el motor de
cualquier corrida ya guardada; no borra historia. Las familias previas conservan
sus resultados y hashes.

## Fuentes primarias

- [Nareit, AFFO](https://www.reit.com/glossary/adjusted-funds-operations-affo):
  mantenimiento y renta lineal; definición no uniforme.
- [Nareit, FFO](https://www.reit.com/glossary/funds-operation-ffo):
  depreciación inmobiliaria y exclusiones de resultados de propiedades.
- [Damodaran, capítulo 26](https://pages.stern.nyu.edu/~adamodar/pdfiles/valn2ed/ch26.pdf):
  flujos inmobiliarios, tasas coherentes con equity/activos y capitalización.
- [Catálogo](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm)
  y [reval.xls](https://pages.stern.nyu.edu/~adamodar/pc/reval.xls).
