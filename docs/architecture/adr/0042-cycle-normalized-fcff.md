# ADR 0042: FCFF con margen normalizado de ciclo

- Estado: aceptado; modelo `experimental`
- Fecha: 2026-10-20
- Alcance: `F4-06`, slice 4.2, cíclicas y commodities
- Depende de: ADR 0003, 0017, 0038, 0039 y 0040

## Contexto

El selector ya distingue cíclicas y commodities, pero su FCFF requiere una
normalización distinta de quitar cargos no recurrentes. Extrapolar el último
margen perpetúa el pico o el valle. Promediar dólares ignora cambios de tamaño.
La ventana SEC conserva cinco ejercicios y no garantiza un ciclo económico
completo; este slice no puede ampliarla silenciosamente.

## Decisión

Se implementa `normalized_fcff`, motor `normalized-fcff-1.0.0`, metodología
`cycle-fcff-1.0.0`, sobre el núcleo FCFF existente. Tiene clasificación, versiones
y controles propios. Los snapshots maduros `fcff-1.6.0`, sus resultados y hashes
quedan idénticos. Las financieras conservan su contrato de equity.

### Historia y fórmula

El owner entrega un snapshot privado con cinco a diez ejercicios consecutivos,
del más antiguo al ejercicio base. Cada año tiene ventas positivas y EBIT
firmado, con moneda, fecha, documento y disponibilidad. Los años sin dato se
rechazan; EBIT cero y pérdidas históricas se incluyen en el promedio.
La fecha fiscal de ventas y EBIT debe coincidir con el año declarado, los cierres
estar separados por 350–380 días y el último reconciliar con las ventas y EBIT
ajustado de la normalización reported/adjusted. No se reconstruye otra base
contable ni se mezclan tácitamente EBIT reportado y ajustado.

```text
margin[y] = operating_EBIT[y] / revenue[y]
historical_margin = SUM(margin[y]) / count(years)
normalized_base_EBIT = current_revenue × historical_margin
target_margin = historical_margin + declared_margin_shift
margin[t] = current_margin + (target_margin - current_margin) × min(t / N, 1)
```

Cada ejercicio pesa igual. `N`, los años hasta normalizar, se declara y debe
caber en el horizonte explícito; `N = 1` es normalización inmediata. Un shift
de margen es un supuesto explícito con motivo, no un cambio de la historia.
El motor recalcula la trayectoria y exige el mismo margen objetivo en el
terminal. El margen histórico y el objetivo deben ser positivos: una empresa
con pérdidas normalizadas persistentes necesita el slice 4.3.

Se documenta por qué la ventana representa el ciclo y qué base contable común
usa. La inflación se trata mediante ratios nominales del mismo ejercicio, no
sumando montos nominales de distintos años; no se infiere inflación cero.
Perímetros que cambiaron, falta de un ciclo representativo o datos que requieren
reexpresión necesitan una revisión o un snapshot reconciliado. La mera cantidad
de años no certifica el ciclo.

Esta vía sirve también para commodities por márgenes de ciclo. No estima un
precio normalizado, unidades, reservas ni futuros; esas vías quedan fuera.
El requerimiento del selector pasa de `normalized_price` a `cycle_margins` para
esta implementación. Sin ese snapshot nombra `missing_required_input`.

### FCFF e incertidumbre

La reinversión explícita usa sales-to-capital: la recuperación del margen no se
confunde con crecimiento de ventas ni con reinversión `growth / ROIC` sobre
NOPAT negativo. Ventas, ratio de reinversión y WACC siguen siendo supuestos
explícitos o componentes fechados bajo los controles FCFF. No se promete que el
capex histórico quede automáticamente normalizado. Un EBIT proyectado negativo
no recibe crédito fiscal inmediato; tampoco se modelan arrastres fiscales.

Bear y bull pueden cambiar ventas, reinversión, crecimiento/ROIC terminal y el
margen objetivo. `terminalEbitMargin` cambia ese objetivo y reconstruye toda la
trayectoria de convergencia; se rechaza `ebitMargin` por período porque eludiría
el vínculo con la normalización. Pasan los mismos checks que la base. La
sensibilidad WACC/g conserva la trayectoria operativa; sus celdas inválidas
siguen nombrando el rechazo.

El resultado agrega una comparación que mantiene el margen actual en todos los
años y el terminal, con las mismas ventas, reinversión, tasas, fracaso, opciones
y puente. Informa EV, valor por acción y diferencia con la base normalizada.
Es un contrafactual de margen, **no un precio spot de commodity** ni un segundo
precio objetivo. Con pérdidas puede arrojar valor negativo; no lo trunca a cero.

### Admisión, tiempo y operación

La selección `method-selection-0.4.0` sólo cambia las decisiones cíclicas y
commodity. La corrida congela las señales fechadas y vuelve a ejecutar el
selector: evidencia futura, otra entidad, conflictos o perfiles prioritarios no
se eluden mediante un resultado de selección escrito a mano. La completitud
industrial sola no admite el método. El rigor queda limitado a `screening` y el
estado siempre es `requires_review`, con un check de modelo experimental.

Se rechazan historia, hechos monetarios y componentes de WACC posteriores al
cutoff. La aceptación de la nota de opciones se declara aparte de las acciones.
`system_recorded` se rechaza porque este contrato de hechos no conserva
`recordedAt` por hecho. La historia del ciclo tampoco puede usar documentos
posteriores al `asOf`; una revisión posterior requiere otro snapshot.

`pnpm valuation:cycle --file <snapshot-privado.json>` calcula sin red ni IA.
Limita el archivo a 512 kB; `--apply` exige el runtime personal y usa el mismo
repositorio append-only, incluido para rechazos. Es CLI local, sin nuevo
endpoint, proveedor, dependencia ni migración. El replay conserva los dos hashes
desde el JSON congelado. No cambia la ingesta SEC ni elimina observaciones.

## Alternativas

- **Promediar EBIT absoluto:** sesga al cambiar el tamaño de la empresa.
- **Ponderar márgenes por ventas históricas:** también es defendible, pero da
  más peso a años con ventas/precios altos. Se documenta la diferencia con
  `normearn.xls`, que usa esta convención.
- **Usar cinco ejercicios SEC automáticamente:** no prueba ciclo completo ni
  comparabilidad contable. La construcción automática queda diferida.
- **Precio commodity por unidades:** requiere otra evidencia, unidades, costos
  e inflación. No se simula cobertura con un precio escrito a mano.
- **Enviar un perfil cíclico a `fcff_base`:** permitiría eludir la normalización.
  La guarda lo sigue rechazando.

## Validación y consecuencias

La [comparación independiente](../../valuation/cycle-normalization-oracle.md)
transcribe los ratios y la ponderación de `normearn.xls`; otro oráculo usa una
perpetuidad de caja constante. Tests cubren escalamiento, pérdidas, nulos, cero,
negativos, moneda, cutoff, clasificación, convergencia, escenarios, sensibilidad,
monotonía, persistencia, dedupe y replay. El corpus externo no se versiona.

La revisión humana del ciclo y de la reinversión sigue siendo necesaria. El motor
no declara cobertura productiva de una empresa real por aceptar una fixture.
La UI por ticker pertenece a Fase 6. Tras persistir corridas debe conservarse
el lector y este motor para reproducirlas; un rollback nunca las borra.

## Fuentes primarias

- [Damodaran, normalizing earnings](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/normearn.htm): márgenes escalados y tiempo hasta normalizar.
- [Commodity value drivers](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/littlebook/commodityvaluedrivers.htm): alternativas por márgenes o precios, ciclos e inflación.
- [Catálogo de planillas](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm) y [normearn.xls](https://www.stern.nyu.edu/~adamodar/pc/normearn.xls): comparación de convenciones.
