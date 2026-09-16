# Metodología de valuación

- Estado: metodología objetivo; motor FCFF base implementado en `src/modules/valuation/`
- Versión metodológica: 0.2.0
- Versión de engine implementada: `fcff-1.0.0` (método `fcff_base`)
- Fecha: 2026-08-21; motor base entregado el 2026-08-24; niveles de rigor y alcance
  de la IA incorporados el 2026-09-04
- Alcance inicial: FCFF para no financieras maduras o en transición
- Decisión de aritmética:
  [`../architecture/adr/0003-decimal-arithmetic-valuation-engine.md`](../architecture/adr/0003-decimal-arithmetic-valuation-engine.md)
- Orden de implementación y frontera IA/motor:
  [`../architecture/adr/0007-ticker-driven-valuation-pivot.md`](../architecture/adr/0007-ticker-driven-valuation-pivot.md)

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

Reordenada por la [ADR 0007](../architecture/adr/0007-ticker-driven-valuation-pivot.md):
los arquetipos dejan de ser el final del camino porque el universo elegido —el
S&P 500— los exige desde el principio. Del orden de 65 financieras y 30 REITs del
índice no admiten FCFF industrial, así que un motor que sólo sabe FCFF cubre menos
de cuatro quintos del universo y produce números inválidos en el resto.

| Etapa    | Cobertura                                                             | Estado inicial |
| -------- | --------------------------------------------------------------------- | -------------- |
| Fase 1   | FCFF base sobre una empresa fixture para probar el flujo reproducible | `done`         |
| Fase 3   | selector de arquetipo, completitud de datos y admisibilidad de método | `planned`      |
| Fase 3   | parámetros Damodaran y costo de capital bottom-up                     | `planned`      |
| Fase 4   | FCFF multi-etapa con leases e I+D capitalizados                       | `planned`      |
| Fase 4.1 | bancos y aseguradoras mediante excess return/residual income o DDM    | `planned`      |
| Fase 4.2 | cíclicas y commodities con normalización de ciclo                     | `planned`      |
| Fase 4.3 | pérdidas/high growth con revenue-to-margin y supervivencia            | `planned`      |
| Fase 4.4 | REIT mediante AFFO/FCFE/DDM y NAV                                     | `planned`      |
| Fase 4.5 | holdings/SOTP y distress sólo con demanda observada                   | `deferred`     |

Un método inexistente devuelve `unsupported_method`, inputs requeridos y motivo.
Nunca cae silenciosamente a FCFF.

## Nivel de rigor declarado

Un dato que no existe no se completa: cambia el nivel de rigor con el que la corrida
puede hacerse, y ese nivel es una salida visible del resultado. Degradar es un
resultado legítimo; inventar un faltante para poder mostrar un número no lo es.

| Nivel         | Requiere                                                                                                                       | Resultado                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `full`        | ≥5 años de fundamentals, industria mapeada, mix geográfico de ingresos, leases e I+D reconstruibles, deuda y cash desagregados | valor por acción con rango y sensibilidad          |
| `standard`    | ≥3 años, industria mapeada, sin mix geográfico confiable                                                                       | CRP por domicilio legal, marcado como aproximación |
| `screening`   | sólo los últimos estados, sin reconstrucción del capital invertido                                                             | rango amplio, ROIC no confiable, terminal grueso   |
| `unsupported` | falta un input estructural del método admisible                                                                                | no valúa; nombra qué falta y por qué               |

El nivel se deriva de la completitud medida, no se elige. La corrida persiste qué
comprobación bajó el nivel, de modo que conseguir ese dato más adelante y volver a
correr sea una acción concreta y no una intuición.

## Motor implementado: `fcff-1.0.0`

El método `fcff_base` cubre `non_financial_mature` con N períodos explícitos
—hasta 20— más un valor terminal. Cualquier otro `assetProfile` devuelve
`unsupported_method`; el motor no lo valúa con el método equivocado.

| Umbral versionado               | Valor   | Modo             | Efecto                                               |
| ------------------------------- | ------- | ---------------- | ---------------------------------------------------- |
| buffer WACC contra `g` terminal | `0.005` | `reject`         | también decide qué celda de sensibilidad es inválida |
| peso del terminal sobre el EV   | `0.85`  | `require_review` | diagnóstico visible, no bloqueo                      |
| techo de tax rate sin motivo    | `0.5`   | `require_review` | por período y en el terminal                         |
| techo de margen terminal        | `0.6`   | `require_review` | sin evidencia sectorial                              |
| puntos por eje de sensibilidad  | `11`    | `reject`         | acota la grilla a 121 celdas                         |

Estos umbrales forman parte de `engine_version`. Cambiarlos incrementa la versión
y no reescribe corridas históricas.

Una corrida rechazada **también** se persiste en `valuation_runs` con su código de
falla y las rutas de campo afectadas: explicar por qué un valor no se calculó es
parte del audit trail (`TM-16`). El índice único sobre `input_hash` más engine y
metodología hace que un replay exacto sea la misma corrida, no una fila nueva.

Fuera del alcance de esta versión y diferido a Fase 4: escenarios bear/base/bull
como conjuntos coherentes de supuestos, normalización reported/adjusted, selector
automático de método y WACC que converge entre etapas.

## Política numérica

- Inputs, supuestos y outputs financieros cruzan fronteras como strings decimales.
- El motor usa aritmética decimal explícita: `decimal.js` con `precision=34` y
  `ROUND_HALF_EVEN`, equivalentes a la precisión decimal128 para los fines del
  motor. La decisión, su configuración y sus alternativas descartadas están en
  [ADR 0003](../architecture/adr/0003-decimal-arithmetic-valuation-engine.md).
- `src/modules/valuation/domain/decimal-policy.ts` es el único módulo que importa
  la librería. Una instancia de `Decimal` no se serializa, no entra en un hash y
  no cruza una frontera; sólo lo hacen strings canónicos.
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

- **`terminal_growth <= risk_free_rate` en la moneda de la valuación.** Es la
  restricción de Damodaran y es más fuerte que el buffer contra el WACC: ninguna
  empresa crece a perpetuidad por encima de la economía en la que opera, y la tasa
  libre de riesgo nominal es el techo observable de esa economía. El buffer sigue
  existiendo, pero como defensa aritmética contra un denominador cerca de cero, no
  como la regla económica;
- `terminal_wacc > terminal_growth + buffer`;
- crecimiento, risk-free e inflación son coherentes con la moneda;
- ROIC terminal y reinversión sostienen el crecimiento;
- margen, beta y leverage convergen a valores defendibles;
- terminal value share excesivo genera diagnóstico visible.

El motor `fcff-1.0.0` implementa hoy sólo el buffer. Incorporar la regla contra el
risk-free incrementa la versión del engine y no reescribe corridas históricas.

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

El eje de WACC reemplaza el costo de capital de todos los períodos explícitos y
del terminal: es un único costo de capital, no un shock a una sola etapa. Un
snapshot con WACC no plano tendría un caso base que no coincide con ninguna
celda, así que el snapshot demo lo mantiene plano y un test verifica que el
número principal sea exactamente una celda de su propia tabla.

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

Una propuesta IA usa schema cerrado, evidence IDs, temperatura baja,
modelo/provider allowlist, timeout y límites de costo. Registra modelo solicitado
y efectivo, routing, provider, ZDR/data collection, prompt version, response ID y
output estructurado.

El policy engine puede aceptar, requerir revisión o rechazar la propuesta. Una IA
no puede inventar consenso, betas, ERP o citas; sobrescribir locks; ejecutar el
DCF; ni completar faltantes silenciosamente.

### Qué decide y qué no

La frontera de la [ADR 0007](../architecture/adr/0007-ticker-driven-valuation-pivot.md):
los hechos numéricos salen de los estados contables, la IA decide lo que Damodaran
trata como juicio, el policy engine valida y el motor calcula.

| Decisión cualitativa                      | Parámetro que mueve                        | Evidencia mínima                       |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------- |
| clasificación de industria                | beta desapalancada y margen objetivo       | descripción del negocio y segmentos    |
| mix geográfico de ingresos                | country risk premium por operaciones       | desagregación geográfica del filing    |
| carácter cíclico y punto del ciclo        | normalización de margen y de precio        | historia de márgenes y del sector      |
| one-offs que distorsionan earnings        | puente reported → normalized               | notas y partidas no recurrentes        |
| plausibilidad del guidance de crecimiento | crecimiento de los períodos explícitos     | guidance citado del MD&A               |
| señales de distress                       | probabilidad de fracaso                    | cobertura de intereses y vencimientos  |
| posición competitiva                      | velocidad de fade del ROIC y ROIC terminal | ROIC histórico y estructura del sector |

Cada fila produce un `Assumption` con `sourceType: "ai_proposed"`, su
`allowedRange`, su `confidence` y sus `evidenceIds`. Fuera de esa tabla, la IA no
propone: no elige el método —eso es el selector determinista—, no fija el
risk-free ni la ERP —eso son datasets fechados— y no toca el puente EV-equity.

### Por qué la propuesta se persiste

La corrida guarda la propuesta como parte del snapshot de entrada, no como una
llamada que se repite. Un replay un año después lee la propuesta persistida y
reproduce el mismo hash sin volver a contactar al modelo. Sin eso, la
no-determinación del modelo se propaga al resultado y `input_hash` deja de
significar algo.

Volver a pedirle al modelo produce **otra corrida**, con su propio hash, igual que
un corte de conocimiento distinto. No es una corrección de la anterior.

### Disciplina de contexto

Los números vienen estructurados de los estados contables; el modelo lee sólo las
secciones que hacen falta para las filas de la tabla. Entregarle documentos
completos multiplica el costo por un orden de magnitud y empeora la extracción al
diluir la señal. La cita de evidencia es obligatoria justamente para que una
propuesta sin respaldo en el texto sea detectable.

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
