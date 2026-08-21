# Metodología de valuación

- Estado: metodología objetivo; motor aún no implementado
- Versión metodológica: 0.1.0
- Fecha: 2026-08-21
- Alcance inicial: FCFF para no financieras maduras o en transición

## Propósito y límite

La valuación combina datos normalizados, selección de método, supuestos,
aritmética determinista y explicación. El sistema entrega escenarios y drivers,
no una recomendación personalizada ni una cifra con falsa precisión.

```text
snapshot -> normalización -> selector -> supuestos -> policy checks
         -> motor determinista -> escenarios/sensibilidad -> diagnósticos
```

Una IA futura puede extraer evidencia, clasificar o proponer rangos. No calcula
DCF, WACC, terminal value ni valor por acción en texto libre.

## Cobertura incremental

| Etapa    | Cobertura                                                             | Estado inicial |
| -------- | --------------------------------------------------------------------- | -------------- |
| Fase 1   | FCFF base sobre una empresa fixture para probar el flujo reproducible | `planned`      |
| Fase 4   | FCFF multi-etapa para no financieras maduras y high growth            | `planned`      |
| Fase 5.1 | bancos y aseguradoras mediante excess return/residual income o DDM    | `planned`      |
| Fase 5.2 | cíclicas y commodities con normalización de ciclo                     | `planned`      |
| Fase 5.3 | pérdidas/high growth con revenue-to-margin y supervivencia            | `planned`      |
| Fase 5.4 | REIT mediante AFFO/FCFE/DDM y NAV                                     | `planned`      |
| Fase 5.5 | holdings/SOTP y distress sólo con demanda observada                   | `deferred`     |

Un método inexistente devuelve `unsupported_method`, inputs requeridos y motivo.
Nunca cae silenciosamente a FCFF.

## Política numérica

- Inputs, supuestos y outputs financieros cruzan fronteras como strings decimales.
- El motor usará aritmética decimal explícita; la implementación prevista es
  Decimal.js con `precision=34` y `ROUND_HALF_EVEN`, equivalentes a la precisión
  decimal128 para los fines del motor.
- La dependencia se incorpora recién con el motor; este documento no la instala.
- Porcentajes se representan internamente como fracciones: `0.08` equivale a 8%.
- Montos conservan moneda y unidad base. No se suman monedas diferentes sin una
  conversión identificada y fechada.
- El redondeo ocurre en bordes de presentación o según una regla contable
  documentada, no entre pasos del cálculo.
- División por cero, NaN, Infinity o un número no finito produce error de policy.
- La serialización canónica ordena claves, normaliza decimales y alimenta el hash
  reproducible.

La precisión y rounding mode forman parte de `engine_version`; un cambio material
incrementa la versión y no reescribe corridas históricas.

## Snapshot de entrada

Una corrida fija:

- entidad, security, listing, moneda y fecha de valuación;
- financial facts con período, unidad y provenance;
- precio, acciones diluidas y claims con fecha compatible;
- ajustes reported/normalized y su puente;
- supuestos aceptados y evidencia;
- datasets de riesgo y sector con versión/hash;
- método, versión del engine y política numérica.

Una consulta histórica usa el valor disponible en `available_at`, no el último
restatement conocido hoy. Regenerar datos o propuestas crea otra corrida.

## Selección de método

El selector recibe sector, regulación, lifecycle, signos y persistencia de EBIT,
net income y FCFF, estabilidad de margen, payout, leverage, exposición cíclica o
commodity, estructura holding y cobertura de datos.

Retorna:

```ts
type MethodSelection = {
  assetProfile: string;
  recommendedMethod: string;
  alternatives: string[];
  requiredInputs: string[];
  confidence: number; // 0..1
  activatedRules: string[];
  unsupportedReasons: string[];
};
```

Reglas mínimas:

- bancos y aseguradoras no usan FCFF/WACC industrial;
- REIT no usa FCF industrial sin ajustes de AFFO/NAV;
- cíclicas y commodities no perpetúan el último margen o spot;
- pérdidas persistentes no usan P/E ni una perpetuidad base sin transición;
- holdings requieren segmentos y assets suficientes para SOTP;
- datos insuficientes producen abstención, no un método genérico.

## Normalización

Reported y normalized se preservan en paralelo. Cada ajuste declara monto,
moneda, período, evidencia, regla y transformación versionada.

Los ajustes posibles incluyen:

- separar operativo, no operativo, cash necesario y exceso de cash;
- capitalizar R&D cuando sea material y exista historia suficiente;
- tratar leases de forma consistente entre EBIT, reinversión y deuda;
- identificar one-offs, adquisiciones, restructuraciones y tasa fiscal;
- reconciliar basic/diluted shares, opciones, RSUs y corporate actions;
- normalizar margen o precio a través de un ciclo defendible.

No se realiza un ajuste sólo para producir un valor más atractivo. Si no puede
construirse el puente, el dato queda reported o la corrida se rechaza.

## Supuestos

```ts
type Assumption = {
  key: string;
  value: string;
  unit: string;
  category: "operating" | "reinvestment" | "risk" | "terminal" | "adjustment";
  sourceType:
    "reported" | "market" | "damodaran" | "analyst" | "ai_proposed" | "user";
  evidenceIds: string[];
  asOf: string;
  confidence: number; // 0..1
  allowedRange: { min: string; max: string };
  rationale: string;
  lockedByUser: boolean;
};
```

Los supuestos se agrupan en:

- **operating:** revenue growth, margen, tax rate y convergencia;
- **reinvestment:** sales-to-capital, ROIC y necesidades de reinversión;
- **risk:** risk-free, ERP, CRP, beta, default spread, leverage y WACC;
- **terminal:** crecimiento, margen, ROIC y estructura estable;
- **adjustment:** cash, deuda, minority interest, opciones y activos no operativos.

Editar un supuesto no invoca una IA. Un lock impide que una propuesta posterior
lo reemplace.

## FCFF no financiera

Para cada período explícito `t`:

```text
revenue_t = revenue_(t-1) * (1 + revenue_growth_t)
ebit_t = revenue_t * ebit_margin_t
nopat_t = ebit_t * (1 - tax_rate_t)
reinvestment_t = revenue_change_t / sales_to_capital_t
fcff_t = nopat_t - reinvestment_t
discount_factor_t = product(1 + wacc_i), i=1..t
pv_fcff_t = fcff_t / discount_factor_t
```

Cuando la reinversión se derive de retorno sobre capital:

```text
reinvestment_rate = growth / roic
reinvestment = nopat * reinvestment_rate
```

La implementación debe elegir y registrar una convención por período; no mezcla
sales-to-capital y `growth / ROIC` sin un puente explícito.

### Terminal value

```text
terminal_reinvestment_rate = terminal_growth / terminal_roic
terminal_fcff = terminal_nopat * (1 - terminal_reinvestment_rate)
terminal_value = terminal_fcff_next / (terminal_wacc - terminal_growth)
```

Precondiciones:

- `terminal_wacc > terminal_growth + buffer`;
- crecimiento, risk-free e inflación son coherentes con la moneda;
- ROIC terminal y reinversión sostienen el crecimiento;
- margen, beta y leverage convergen a valores defendibles;
- terminal value share excesivo genera diagnóstico visible.

### Puente EV-equity

```text
enterprise_value = sum(pv_fcff) + pv_terminal_value
equity_value = enterprise_value
             + excess_cash
             + non_operating_assets
             - debt
             - minority_interest
             - other_claims
value_per_share = equity_value / diluted_shares
```

Las acciones deben ser positivas, ajustadas de forma compatible y fechadas. Una
claim faltante no se presume cero sin evidencia.

## Costo de capital

1. Elegir moneda nominal o real antes de estimar tasas.
2. Usar un risk-free consistente con esa moneda.
3. Versionar ERP madura y CRP.
4. Ponderar riesgo país por exposición operativa cuando exista evidencia; no usar
   sólo domicilio legal.
5. Preferir beta bottom-up sectorial, desapalancada y reapalancada a estructura
   objetivo.
6. Estimar costo de deuda desde risk-free y default spread compatible.
7. Aplicar tax shield con tasa marginal defendible.
8. Hacer converger beta, leverage y costo de capital en estado estable.

Cada componente conserva fecha, fuente, unidad, moneda y evidencia.

## Escenarios y sensibilidad

Bear, base y bull son conjuntos coherentes de supuestos, no multiplicadores
arbitrarios sobre el resultado. Cada escenario declara qué drivers cambian y por
qué. Las probabilidades son opcionales y sólo se muestran con base defendible.

La sensitivity WACC/g:

- mantiene constantes los demás inputs;
- rechaza celdas donde WACC no supera `g + buffer`;
- muestra unidad, rango y step;
- no se interpreta como distribución de probabilidad.

Monte Carlo queda fuera del motor inicial. Sólo se habilita con distribuciones,
correlaciones, seed persistido y tests.

## Policy checks

| Check                            | Resultado mínimo                                         |
| -------------------------------- | -------------------------------------------------------- |
| WACC versus crecimiento terminal | `reject` si viola el buffer                              |
| acciones diluidas                | `reject` si no son positivas o comparables               |
| valores finitos                  | `reject` para NaN/Infinity/división inválida             |
| moneda y unidad                  | `reject` si se combinan sin conversión trazable          |
| reinversión y crecimiento        | `require_review` o `reject` si no son coherentes         |
| margen terminal                  | `require_review` fuera del rango sectorial sin evidencia |
| tax rate y leverage              | `require_review` fuera de rango defendible               |
| exposición país                  | `reject` si los pesos no suman 100% dentro de tolerancia |
| freshness e inputs               | `reject` o `require_review` según el método              |
| peso del terminal                | diagnóstico visible si excede el umbral versionado       |

Modos permitidos: `reject`, `require_review` y `autocorrect_with_trace`. Ninguna
corrección es silenciosa; registra valor original, regla, valor nuevo y motivo.

## Output y reproducibilidad

```ts
type ValuationResult = {
  valuationRunId: string;
  ticker: string;
  asOf: string;
  currency: string;
  engineVersion: string;
  methodologyVersion: string;
  inputHash: string;
  assetProfile: string;
  valuationMethod: string;
  methodSelection: MethodSelection;
  assumptions: Assumption[];
  scenarios: Record<string, unknown>;
  result: Record<string, string>;
  sensitivity: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  evidenceIds: string[];
};
```

Con el mismo input canónico, engine, metodología y seed, el resultado debe ser
idéntico. Replay lee snapshots persistidos; no consulta datos live ni regenera una
propuesta IA.

## Diagnósticos y presentación

El resultado muestra:

- rango bear/base/bull y drivers;
- tabla de flujos y terminal value;
- puente EV-equity y valor por acción;
- sensitivity con celdas inválidas explícitas;
- calidad y freshness de inputs;
- policy checks y ajustes;
- fuentes y evidencia;
- limitaciones del método y model risk.

Los escenarios de descuento son matemáticos y configurables para uso del owner.
No se presentan como una recomendación personalizada.

## IA y evidencia

Una propuesta IA futura usa schema cerrado, evidence IDs, temperatura baja,
modelo/provider allowlist, timeout y límites de costo. Registra modelo solicitado
y efectivo, routing, provider, ZDR/data collection, prompt version, response ID y
output estructurado.

El policy engine puede aceptar, requerir revisión o rechazar la propuesta. Una IA
no puede inventar consenso, betas, ERP o citas; sobrescribir locks; ejecutar el
DCF; ni completar faltantes silenciosamente.

## Validación

Cada fórmula o método requiere:

- golden fixtures calculados de forma independiente;
- comparación documentada contra spreadsheets públicas de Damodaran cuando
  corresponda;
- unit tests de `null`, cero, negativos, moneda incompatible y no finitos;
- property tests con precondiciones: mayor WACC no aumenta valor ceteris paribus;
  mayor deuda reduce equity value con EV y demás inputs fijos; escenarios se
  ordenan cuando sus supuestos lo garantizan;
- tolerancias, convenciones y discrepancias conocidas documentadas;
- estado `experimental | reviewed | production` y owner del método.

Un spreadsheet de referencia no es el único oracle. Fórmulas críticas necesitan
cálculo alternativo o revisión independiente.

## Gobierno de cambios

- Una modificación material incrementa `methodology_version` y engine version.
- Corridas previas permanecen inmutables y señalan si una corrección las afecta.
- El changelog registra fórmula, motivo, impacto, fixtures y estrategia de replay.
- Incorporar un nuevo arquetipo requiere su propio slice, selector, inputs,
  fixtures, diagnósticos y gate.
- Esta metodología se revisa junto con el
  [roadmap](../finance-portal-masterplan/06_PHASED_ROADMAP.md) antes de implementar
  cualquier motor.

## Referencias primarias

- [Damodaran: materiales y model chooser](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valuation/val.htm)
- [Damodaran: spreadsheets por método](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm)
- [Damodaran: datasets actuales](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html)
- [Damodaran: normalización de earnings](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/normearn.htm)
