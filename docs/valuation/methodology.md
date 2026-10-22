# Metodología de valuación

- Estado: metodología objetivo; motor FCFF, normalización de ciclo, crecimiento/pérdidas, AFFO/NAV REIT y exceso de retorno financiero experimental implementados en `src/modules/valuation/`
- Versión metodológica: 0.12.0 (la corrida lleva selección, completitud y rigor desde `F3-03`, el costo de capital construido desde `F3-06`, el riesgo país ponderado por operaciones desde `F5-05`, las decisiones cualitativas con la propuesta de la IA desde `F5-06` la capitalización de arrendamientos e I+D desde `F4-01` el techo del crecimiento terminal en la libre de riesgo desde `F4-02` la normalización reported/adjusted del ejercicio base desde `F4-03` los escenarios bear/base/bull desde `F4-04` y las opciones y unidades de empleados y la probabilidad de fracaso desde `F4-05`)
- Versión de engine implementada: `fcff-1.6.0` (método `fcff_base`)
- Motor de crecimiento/pérdidas: `growth-fcff-1.0.0`, metodología propia del mismo nombre (`fcff_three_stage` y `revenue_margin_survival`, [ADR 0043](../architecture/adr/0043-revenue-margin-survival.md)); no cambia los motores previos.
- Motor cíclico: `normalized-fcff-1.0.0`, metodología `cycle-fcff-1.0.0` (`normalized_fcff`, [ADR 0042](../architecture/adr/0042-cycle-normalized-fcff.md)); márgenes de ciclo para cíclicas y commodities, sin cambiar `fcff-1.6.0`.
- Motor REIT independiente: `affo-nav-1.0.0`, metodología `reit-equity-1.0.0` (`affo_nav`, [ADR 0044](../architecture/adr/0044-reit-affo-nav.md)); propiedades con AFFO conciliado y NAV separado, experimental y screening.
- Motor financiero independiente: `excess-return-1.0.0`, metodología `financial-equity-1.0.0` (método `excess_return`, `F4-06`, [ADR 0041](../architecture/adr/0041-financial-equity-excess-return.md)); no cambia la versión ni los hashes FCFF.
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
| Fase 3   | selector de arquetipo, completitud de datos y admisibilidad de método | `done`         |
| Fase 3   | parámetros Damodaran y costo de capital bottom-up                     | `done`         |
| Fase 4   | leases e I+D capitalizados con puente sobre EBIT, capital y deuda     | `done`         |
| Fase 4   | FCFF multi-etapa: regla terminal, normalización y escenarios          | `done`         |
| Fase 4.1 | bancos y aseguradoras mediante exceso de retorno sobre equity         | `experimental` |
| Fase 4.2 | cíclicas y commodities con normalización de ciclo                     | `experimental` |
| Fase 4.3 | pérdidas/high growth con revenue-to-margin y supervivencia            | `experimental` |
| Fase 4.4 | REIT de propiedades mediante AFFO distribuible y NAV                  | `experimental` |
| Fase 4.5 | holdings/SOTP y distress sólo con demanda observada                   | `deferred`     |

Un método inexistente devuelve `unsupported_method`, inputs requeridos y motivo.
Nunca cae silenciosamente a FCFF.

## REIT de propiedades: AFFO distribuible y NAV

`affo-nav-1.0.0` y `reit-equity-1.0.0` (`F4-06 / 4.4`,
[ADR 0044](../architecture/adr/0044-reit-affo-nav.md)) usan un snapshot privado
explícito. El selector `method-selection-0.6.0` exige preflight propio, aunque
el FCFF industrial esté completo. Mortgage y hybrid REITs se rechazan.

La conciliación anual conserva NI común, depreciación inmobiliaria, ganancias o
pérdidas de venta, deterioros, ajuste proporcional a FFO de JV, mantenimiento
recurrente y renta lineal no cobrada. Todos tienen documento, moneda, cierre y
disponibilidad. No se añade compensación en acciones ni se certifica el AFFO
publicado por un emisor. Faltante no es cero, y AFFO no positivo requiere otro
modelo. Se admite un ejercicio de 350–380 días, no más viejo que 380 días al corte.

El DCF descuenta caja común con `Ke = rf + beta_equity × ERP + CRP`. Por cada
año conserva AFFO, crecimiento financiado del siguiente año, retención
`growth_next / return_on_new_equity`, reinversión, distribución y descuento.
El primer crecimiento se apoya en capital ya invertido al corte. En el último
año la reinversión financia el crecimiento terminal. El mantenimiento ya se
restó de AFFO; la retención financia sólo crecimiento. El terminal repite la
retención, exige `g <= rf`, `Ke > g + 0.005`, retornos positivos y payout en
`[0,1]`. Interés, impuestos, preferidas y minoritarios ya están en la caja común;
no se resta deuda otra vez ni se añade caja al DCF.

NAV es una segunda lectura, sin promedio con el DCF: NOI consolidado forward
sobre cap rate compatible, más caja excedente y otros activos, menos deuda,
preferidas, minoritarios, otras obligaciones y costo corporativo capitalizado.
Las partidas se miden al `asOf`. La evidencia y el motivo describen cobertura,
JV, ground leases y G&A para evitar omisiones o duplicados. NAV negativo conserva
su signo y exige revisión. Opciones se recalculan y restan una sola vez de cada
equity; básicas más unidades no consolidadas forman el denominador, sin opciones.

Bear/base/bull son snapshots enteros con el mismo horizonte y motivos. La
sensibilidad beta terminal/g mantiene fija la trayectoria de AFFO, recalcula
la retención del último año para financiar el nuevo `g` y el terminal; otro
vector cambia cap rate de NAV. Celdas inválidas conservan sus rechazos. Las
sensibilidades no asignan probabilidades y el orden de DCF/NAV se revisa por separado.

El modelo es `experimental`, rigor `screening`, siempre `requires_review`.
No certifica capacidad fiscal de distribución ni refinanciación, y no proyecta
emisiones o principal. `system_recorded` se rechaza sin registro por hecho.
`pnpm valuation:reit --file <snapshot.json>` calcula sin red ni IA, limitado a
512 kB y dry run por defecto. `--apply` exige personal, registra resultado o
rechazo y permite replay desde JSON. No crea UI ni arma snapshots automáticamente.
El [oráculo](reit-oracle.md) compara conciliación y capitalización de `reval.xls`
y una perpetuidad financiada; documenta las diferencias de convención.

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

## Motor de crecimiento/pérdidas: `growth-fcff-1.0.0`

`F4-06 / 4.3` implementa `fcff_three_stage` para alto crecimiento y
`revenue_margin_survival` para pérdidas persistentes. `revenueMargin` congela
clasificación fechada, crecimiento inicial, años de alto crecimiento, objetivo
de margen, plazo de convergencia y motivos de mercado, margen y financiación.
El selector `method-selection-0.5.0` exige ese preflight y el motor vuelve a
ejecutarlo; ningún perfil prioritario se elude mediante un selector escrito.

Tras `H` años de crecimiento constante, la tasa converge linealmente a `g` en
los `N-H` años restantes. El margen parte del EBIT base ajustado/ventas y alcanza
linealmente el objetivo positivo en `M <= N` años. El terminal sostiene ese
margen y `g`, sujeto al techo de libre de riesgo y el buffer del WACC.
La reinversión explícita usa sales-to-capital; no se calcula un CAGR de pérdidas.

El saldo inicial de pérdidas compensables debe tener documento, moneda y fecha;
`null` bloquea. Se declara límite anual de uso `[0, 1]` y motivo. Un EBIT
negativo no devuelve impuestos, incrementa el saldo; uno positivo consume hasta
el límite y tributa sobre el resto. Cada período muestra saldo inicial, uso,
saldo final, renta imponible e impuestos. El terminal aplica impuestos normales,
sin convertir el remanente finito en ahorro perpetuo; el saldo omitido queda
visible. El pool simplificado no representa caducidad, créditos, cambios de
control ni reglas por jurisdicción. El saldo del cierre base no se suma dos veces.

`growthDiagnostics` conserva las trayectorias y el pico de necesidad de fondos
operativos: `max(0, -min(cumulative_FCFF))`, antes de caja y financiación.
No se vuelve a restar del valor: todos los FCFF negativos ya se descuentan.
No se estiman términos de emisiones futuras. La supervivencia mantiene la
convención fechada a diez años y recupero de ADR 0040, aunque el horizonte de
proyección sea diferente. Opciones, acciones y puente se recalculan una vez.

Bear/bull pasan los mismos checks: el driver de margen terminal reconstruye los
márgenes; el de crecimiento terminal reconstruye la transición de ventas.
Un driver por año de crecimiento debe declarar la trayectoria completa coherente
con su primer valor y el terminal. Se rechazan márgenes por período que eludan
la convergencia. Sensibilidad WACC/g mantiene el pronóstico explícito fijo.

El modelo es `experimental`, con rigor limitado a `screening` y resultado siempre
`requires_review`. Cutoff, moneda, hechos, componentes de tasas y aceptación de
la nota de empleados se verifican; no admite `system_recorded` sin fecha de
registro por hecho. `pnpm valuation:growth --file <snapshot-privado.json>`
calcula sin red ni IA y sólo `--apply` persiste bajo el guard personal,
incluidos rechazos. Replay no consulta fuentes. La construcción automática del
snapshot y la UI quedan fuera de este incremento.

La [ADR 0043](../architecture/adr/0043-revenue-margin-survival.md) y el
[oráculo independiente](revenue-margin-oracle.md) documentan la comparación con
`higrowth.xls`, sus diferencias de convergencia y la perpetuidad diferida con
escudo fiscal finito. Los snapshots anteriores conservan números y hashes.

## Motor de ciclo: `normalized-fcff-1.0.0`

`F4-06 / 4.2` incorpora `normalized_fcff` para cíclicas y commodities por
márgenes de ciclo. El snapshot privado agrega `cycleNormalization`: cinco a diez
ejercicios consecutivos con ventas positivas y EBIT con signo, procedencia por
hecho, una base contable común, justificación del ciclo y años hasta normalizar.
No expande la ventana SEC de ADR 0017 ni asume que cinco años prueban un ciclo.

El margen histórico es la media **con igual peso por año** de `EBIT / revenue`.
El EBIT normalizado de control es ese margen por ventas actuales; el objetivo
puede llevar un shift explícito con motivo. La trayectoria converge linealmente
desde el margen ajustado actual al objetivo en `N` años, dentro del horizonte.
El terminal debe usar el objetivo y el motor recalcula cada margen. Se incluyen
ceros y pérdidas históricas, pero una media u objetivo no positivos se rechazan.
La base nominal de cada ratio usa ventas y EBIT del mismo año; no se promedian
montos nominales a través del tiempo. El último ejercicio debe reconciliar con
las ventas y EBIT ajustado de la corrida.

La reinversión explícita usa sales-to-capital. La recuperación de margen no es
crecimiento de ventas; un EBIT proyectado negativo no recibe crédito fiscal ni
arrastre automático. Se conservan los controles de WACC, riesgo país, fracaso,
recupero, opciones y puente de FCFF. La aceptación de la nota de empleados se
congela aparte. La clasificación y los componentes fechados se vuelven a
verificar al cutoff; `system_recorded` no es admisible sin fecha de registro por
hecho. El rigor queda limitado a `screening`, el modelo a `experimental` y la
corrida a `requires_review`, incluso con cinco años completos.

Bear/bull usan los mismos checks; `terminalEbitMargin` cambia el objetivo de
ciclo y reconstruye su trayectoria completa, con el motivo del driver. No se
permite el driver `ebitMargin` por período para este método. La sensibilidad
WACC/g conserva la operación base. `cycleComparison` muestra el valor manteniendo
el margen actual en todos los años y el terminal, junto con su diferencia:
es un contrafactual de margen, no de precio spot de commodity.

`pnpm valuation:cycle --file <snapshot-privado.json>` calcula sin red ni IA;
`--apply` persiste sólo en personal, incluidos rechazos. Replay usa el snapshot
congelado. No se automatiza su construcción ni se agrega una página. La
[ADR 0042](../architecture/adr/0042-cycle-normalized-fcff.md) y el
[oráculo independiente](cycle-normalization-oracle.md) explican la diferencia
con `normearn.xls`: su media ponderada por ventas difiere de la media anual.
El segundo oráculo es una perpetuidad de caja constante.

## Motor financiero: `excess-return-1.0.0`

`F4-06` incorpora exceso de retorno para bancos y aseguradoras con contrato
propio. El valor parte del patrimonio **común**, suma el valor presente de
`(ROE - Ke) × patrimonio_inicial` por año y el terminal, y descuenta al costo
de equity. Las utilidades retenidas actualizan el patrimonio para el año siguiente.
El terminal deriva `retention = g / ROE` y usa el cierre del último año
explícito sin adelantarlo por `g`. Opciones y unidades usan el mismo cálculo
de `F4-05`; depósitos y reservas no entran en un puente industrial.

La selección financiera tiene versión `method-selection-0.3.0` y exige un
preflight propio; completar EBIT o deuda no habilita este método. El snapshot
declara los componentes fechados de `Ke = rf + beta_equity × ERP + CRP`,
pronósticos anuales y sus motivos. Se rechazan patrimonio común no positivo,
ROE explícito negativo, payout fuera de `[0,1]`, beta negativa, Ke no positivo,
inconsistencia de moneda o tiempo y terminal sin retención coherente, con
`g > rf` o sin el buffer `Ke > g + 0.005`.

El modelo queda `experimental`, rigor `screening` y siempre `requires_review`:
no certifica capital distribuible, calidad de activos o reservas, ni clean
surplus. Cada revisión faltante tiene un check propio. No admite la base
`system_recorded` porque el contrato de hechos no incluye su fecha de registro.
Patrimonio y acciones deben estar medidos al `asOf`; usar un balance viejo
sin un roll-forward explícito se rechaza. La aceptación de la nota de opciones
se verifica por separado de la fecha del registro accionario.

Bear y bull se valúan completos. La sensibilidad varía beta de equity **terminal**
y `g`, con Ke derivado por fila, trayectoria explícita fija, máximo 121 celdas
y rechazos nombrados. Ambas superficies son salidas de dominio; aún no hay
una página de resultados financieros. `pnpm valuation:financial --file <path>`
calcula el snapshot privado sin red ni IA; `--apply` lo registra en el runtime
personal. `pnpm valuation:replay` reproduce el método desde ese mismo JSON.

La [ADR 0041](../architecture/adr/0041-financial-equity-excess-return.md)
documenta las convenciones y límites. La
[comparación independiente](financial-equity-oracle.md) reproduce diez años y
terminal de `eqexret.xls`, y otro oráculo reconcilia contra un DDM sintético.
La construcción automática del snapshot desde filings pertenece a un incremento
posterior; la existencia del motor no declara cobertura productiva de empresas.

## Motor FCFF implementado: `fcff-1.6.0`

`fcff-1.1.0` (`F4-01`) agrega al puente EV-equity la claim `leaseDebt`, la deuda
por arrendamientos operativos que deriva la capitalización. `fcff-1.2.0`
(`F4-02`) agrega la regla terminal `g <= risk_free_rate` (ver "Terminal
value"). `fcff-1.3.0` (`F4-03`) exige que la deuda y la caja excedente del
puente sean las que deriva la normalización. `fcff-1.4.0` (`F4-04`) valúa
bear y bull enteros desde sus supuestos (ver "Escenarios y sensibilidad").
`fcff-1.5.0` (`F4-05`) resta las opciones de empleados vivas y divide por
acciones en circulación más unidades no consolidadas (ver "Puente EV-equity");
`fcff-1.6.0` pondera el DCF por supervivencia y recupera la mitad del capital
en libros reportado (ver "Supervivencia y recupero"). El resto del motor es el
de `fcff-1.0.0`.

El método `fcff_base` cubre `non_financial_mature` con N períodos explícitos
—hasta 20— más un valor terminal. Cualquier otro `assetProfile` devuelve
`unsupported_method`; el motor no lo valúa con el método equivocado.

| Umbral versionado                   | Valor                | Modo             | Efecto                                               |
| ----------------------------------- | -------------------- | ---------------- | ---------------------------------------------------- |
| buffer WACC contra `g` terminal     | `0.005`              | `reject`         | también decide qué celda de sensibilidad es inválida |
| `g` terminal contra libre de riesgo | `≤`, borde inclusivo | `reject`         | también; rechaza la columna entera de la grilla      |
| peso del terminal sobre el EV       | `0.85`               | `require_review` | diagnóstico visible, no bloqueo                      |
| techo de tax rate sin motivo        | `0.5`                | `require_review` | por período y en el terminal                         |
| techo de margen terminal            | `0.6`                | `require_review` | sin evidencia sectorial                              |
| puntos por eje de sensibilidad      | `11`                 | `reject`         | acota la grilla a 121 celdas                         |

Estos umbrales forman parte de `engine_version`. Cambiarlos incrementa la versión
y no reescribe corridas históricas.

Una corrida rechazada **también** se persiste en `valuation_runs` con su código de
falla y las rutas de campo afectadas: explicar por qué un valor no se calculó es
parte del audit trail (`TM-16`). El índice único sobre `input_hash` más engine y
metodología hace que un replay exacto sea la misma corrida, no una fila nueva.

Los escenarios bear/base/bull (`F4-04`), la normalización reported/adjusted
(`F4-03`) y el WACC que converge entre etapas (`F3-06`) ya forman parte de la
corrida.

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
  version: string;
  status: "selected" | "unsupported_method";
  assetProfile: string | null;
  recommendedMethod: string | null;
  alternatives: string[];
  requiredInputs: string[];
  confidence: number | null; // null hasta calibrar la escala
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

### `F3-01`, incremento 1: contrato de decisión

El selector recibe hechos resueltos para una entidad legal con tiempo efectivo,
corte de conocimiento, política de revisión y base de ajuste declarados. Cada
entrada conserva fuente, período y `available_at`: una clasificación o un filing
conocido después del corte no puede decidir una corrida histórica.

`unknown` es distinto de `false`: la ausencia de un hecho no prueba que una
empresa carezca de esa característica.

| Entrada                                                        | Uso en la decisión                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Clasificación sectorial versionada, industria y regulación     | Contexto y señales de banco, aseguradora o REIT; el sector amplio por sí solo no prueba el subtipo. |
| Estructura societaria y segmentos                              | Distinguir holding y verificar si existen piezas para SOTP.                                         |
| EBIT, net income y FCFF por ejercicio                          | Signo y persistencia; un solo ejercicio negativo no prueba pérdidas persistentes.                   |
| Crecimiento de ingresos y estabilidad del margen por ejercicio | Distinguir madurez, transición y exposición cíclica sin extrapolar el último año.                   |
| Dividendos, payout, deuda y restricciones de capital           | Comprobar la admisibilidad de métodos de equity y de FCFF.                                          |
| Exposición a commodities o ciclos, con evidencia fechada       | Evitar usar spot o margen reciente como estado estable.                                             |
| Cobertura y calidad de cada entrada anterior                   | Nombrar qué dato falta, está en conflicto o no es comparable.                                       |

La precedencia inicial evalúa primero las exclusiones de FCFF industrial. Una señal
positiva de banco o aseguradora prevalece sobre la etiqueta sectorial amplia;
después se examinan REIT, holding y distress; luego commodity, ciclo y pérdidas
persistentes o alto crecimiento. Sólo tras descartar esos casos con evidencia
suficiente puede recomendarse `fcff_base` para `non_financial_mature`. Dos señales
positivas incompatibles no se resuelven por el orden de la lista: producen
abstención con ambas reglas activadas. La taxonomía
`sp500-wikipedia-gics-sector` de `F7-02` tiene un solo nivel y no demuestra por
sí misma que una empresa sea banco, aseguradora o REIT.

| Situación                                                             | Resultado requerido                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Falta un dato necesario para distinguir un arquetipo excluido de FCFF | `unsupported_method` con el input y el motivo `missing_classification_evidence`.                           |
| Evidencias vigentes incompatibles para el mismo perfil                | `unsupported_method` con ambas reglas y `conflicting_evidence`.                                            |
| Arquetipo identificado, pero su método aún no está implementado       | `unsupported_method` con el método previsto y `method_not_implemented`; nunca sustituirlo por `fcff_base`. |
| Falta un input estructural del método identificado                    | `unsupported_method` con el input y `missing_required_input`.                                              |

La salida conserva `assetProfile`, `recommendedMethod`, `alternatives`,
`requiredInputs`, `confidence`, `activatedRules` y `unsupportedReasons`; las
razones anteriores son códigos propuestos para su schema. Este incremento
no fija umbrales numéricos de persistencia, crecimiento, margen o apalancamiento,
ni calibra `confidence`: esas reglas necesitan definición y fixtures antes de
codificar el selector. El guard actual del motor sigue admitiendo sólo
`non_financial_mature` con `fcff_base`; este contrato no amplía su cobertura.

### `F3-01`, incremento 2: casos de aceptación

Estos casos sintéticos fijan la salida observable antes de implementar reglas
numéricas. «Evidencia directa» significa una aserción fechada del subtipo o una
restricción regulatoria identificada; «descartado» exige evidencia, no la ausencia
de una fila. Todos usan el mismo tiempo efectivo y corte de conocimiento salvo
donde se indica otro corte.

| Hechos al corte                                                                    | Resultado esperado                                                                                      | Regla o motivo                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Banco identificado por evidencia directa; los demás perfiles descartados           | `bank`, exceso de retorno si su snapshot financiero está completo; de lo contrario nombra requisitos    | `bank_regulated`, `missing_required_input`    |
| Aseguradora identificada por evidencia directa                                     | `insurer`, exceso de retorno si su snapshot financiero está completo; de lo contrario nombra requisitos | `insurer_regulated`, `missing_required_input` |
| REIT identificado por evidencia directa                                            | `reit`, AFFO/NAV con preflight propio; sin snapshot explícito nombra los inputs faltantes               | `reit_structure`, `missing_required_input`    |
| Sólo consta el sector amplio `Financials`; subtipo desconocido                     | Abstención; no recomendar FCFF ni asumir banco                                                          | `missing_classification_evidence`             |
| Evidencia directa simultánea de banco y REIT, sin resolución                       | Abstención con ambas reglas activadas                                                                   | `conflicting_evidence`                        |
| No financiera madura con exclusiones descartadas y inputs de `fcff_base` presentes | `non_financial_mature`, `fcff_base`                                                                     | `mature_non_financial`                        |
| La única evidencia de subtipo se publicó después del corte de conocimiento         | Abstención en ese corte; una corrida posterior puede clasificar                                         | `missing_classification_evidence`             |

Los casos prueban prioridad, conflicto, ausencia y conocimiento temporal. No
convierten `Financials` en subtipo ni asignan umbrales de EBIT, crecimiento o
leverage. `confidence` continúa sin escala calibrada y no debe mostrarse como
probabilidad de acierto; su regla y las fixtures ejecutables siguen pendientes
antes de cerrar `F3-01`.

### `F3-01`, incremento 3: selector sobre evidencia explícita

`method-selection-0.1.0` implementa los casos anteriores en dominio puro. Su
entrada identifica una entidad legal y reúne señales de perfil ya clasificadas
para ella, cada una con vigencia efectiva, `available_at`, `recorded_at`,
fuente y hash, más la consulta point-in-time y un preflight estructural de FCFF. Filtra cada señal con el tiempo
efectivo y el corte de conocimiento; dos afirmaciones de perfiles distintos o
versiones simultáneas de un mismo perfil producen `conflicting_evidence`.
Para admitir `fcff_base`, exige evidencia positiva de
`non_financial_mature`, evidencia negativa explícita para los demás perfiles e
inputs FCFF verificados. Los otros perfiles conservan su método previsto pero
devuelven `method_not_implemented`. `confidence=null` en toda salida de esta
versión: ningún número se presenta como probabilidad sin calibración.

Esta versión no infiere las señales desde EBIT, crecimiento, regulación ni
sector. El adaptador que las constituya deberá versionar y probar esas reglas,
sus umbrales y su fuente antes de conectar el selector a una valuación real.
`F3-01` sigue abierto hasta ese gate y el perfil de completitud de `F3-02`
no se anticipa con el booleano de preflight.

### `F3-01`, incremento 4: señales SIC observadas de la SEC

`sec-sic-profile-1.0.0` lee el SIC del `submissions` de la SEC con el parser
existente, valida el CIK contra la entidad solicitada y produce una señal
positiva sólo para los códigos específicos de la
[lista SIC oficial de la SEC](https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list):

| Perfil      | SIC admitidos                                  | Límite                                                            |
| ----------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Banco       | `6021`, `6022`, `6029`, `6035`, `6036`         | No incluye servicios financieros o agentes bancarios más amplios. |
| Aseguradora | `6311`, `6321`, `6331`, `6351`, `6361`, `6399` | No incluye brokers de seguros ni planes médicos ambiguos.         |
| REIT        | `6798`                                         | `6500` y otros operadores inmobiliarios no prueban ser REIT.      |

Los códigos son categorías publicadas, no umbrales de EBIT, crecimiento ni
apalancamiento. La regla no genera negativos: un SIC no mapeado o inválido no
prueba que la empresa no sea banco, aseguradora o REIT. El SIC de
`submissions` describe el filer **actual** sin inicio histórico defendible; por
eso `validFrom` y `availableAt` se fijan en `fetchedAt`. Consultas anteriores
se abstienen. Una nueva captura con SIC distinto debe cerrar o superseder la
anterior antes de publicarse; este incremento no la persiste ni la conecta aún
con la corrida.

La elección de un método de equity para bancos y aseguradoras sigue la
[distinción de Damodaran para firmas financieras](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/littlebook/financialsvccompanies.htm).
El mapeo SIC es una señal de clasificación, no evidencia de que ya estén
presentes los inputs del método. Siguen sin definirse umbrales cuantitativos
para crecimiento, pérdidas persistentes, ciclo y distress; los datos actuales
no justifican convertirlos en reglas de admisión.

### `F3-01`, incremento 5: señales desde datos reales y cierre

La [ADR 0031](../architecture/adr/0031-on-demand-company-assessment.md) decide
que la evaluación es **a demanda**: `pnpm valuation:assess --ticker …` observa el
SIC de la empresa (un request a `submissions`), lo guarda como aserción fechada
en su observación (`sec-sic-classification-1.0.0`) y la evalúa sobre los
fundamentals ya ingeridos. El incremento 4 queda reemplazado: la regla vive en el
dominio y produce también evidencia negativa.

`method-selection-0.2.0` ordena los perfiles —banco, aseguradora o REIT; holding;
distress; commodity; ciclo; pérdidas persistentes; alto crecimiento— y elige el
primero con evidencia positiva, siempre que todos los que lo preceden tengan
evidencia negativa. `non_financial_mature` es el residuo. Dos financieros
positivos a la vez siguen siendo `conflicting_evidence`.

| Regla                               | Perfil                     | Positivo                                                                                                                 | Negativo                                                                                                                                        |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `sec-sic-profile-2.0.0`             | banco / aseguradora / REIT | SIC `6021`, `6022`, `6029`, `6035`, `6036` / `6311`, `6321`, `6331`, `6351`, `6361`, `6399` / `6798`                     | SIC fuera de 6000–6799, o mapeado a otro de los tres                                                                                            |
| `sec-sic-profile-2.0.0`             | holding                    | ninguno: la lista de la SEC no publica el 6719                                                                           | SIC fuera de 6000–6799 o mapeado                                                                                                                |
| `sec-sic-profile-2.0.0`             | commodity                  | división B (minería, carbón, petróleo y gas) y `2911` refinación                                                         | cualquier otro SIC válido                                                                                                                       |
| `sec-sic-profile-2.0.0`             | ciclo                      | bienes durables y de capital, acero y aluminio, autos, aeronaves, transporte aéreo y marítimo, construcción de viviendas | cualquier otro SIC válido                                                                                                                       |
| `fundamental-profile-signals-1.0.0` | distress                   | cobertura `EBIT / intereses` < 1,25 dos ejercicios seguidos, o patrimonio ≤ 0 con EBIT < 0                               | las dos ramas falsas; o EBIT > 0 dos años con patrimonio > 0; o resultado neto > 0 dos años con patrimonio > 0; o caja que cubre todo el pasivo |
| `fundamental-profile-signals-1.0.0` | pérdidas persistentes      | EBIT < 0 en dos de los tres últimos ejercicios                                                                           | tres ejercicios conocidos con menos de dos pérdidas                                                                                             |
| `fundamental-profile-signals-1.0.0` | alto crecimiento           | ventas × 1,15³ o más en tres ejercicios                                                                                  | por debajo, con base positiva y ejercicios consecutivos                                                                                         |

El 1,25 es el borde inferior de `B-` en la
[tabla de rating sintético de Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html)
para empresas grandes: debajo empiezan `CCC` a `D`. Los «dos de tres» y el 15 %
son **decisiones del proyecto**: el sistema de valuación pide signo, persistencia
y crecimiento sin fijar cifras, y ninguna fuente primaria las publica.

La serie anual (`annual-fundamentals-1.0.0`) reconoce un ejercicio por el ancla
`fp = FY` del linaje (±7 días, para años de 52/53 semanas), descarta los doce
meses móviles y toma cada partida de conceptos alternativos en orden. El EBIT
reconstruido, el resultado neto y la liquidez son alternativas declaradas: la
evidencia queda `declared_alternative` y la confianza baja.

`confidence` es ordinal: `high` si toda la evidencia que decidió es primaria y
ninguna señal cedió, `medium` con una de las dos cosas, `low` con ambas, `null`
sin perfil. No es una probabilidad.

Medido el 2026-10-02 sobre la muestra declarada del gate, con el SIC observado de
las 30 empresas:

| Arquetipo declarado        | Empresas                                    | Resultado del selector                                                                                                                 |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| madura                     | AAPL, GOOGL, DUK, JNJ                       | las 4 maduras con `fcff_base`                                                                                                          |
| banco / aseguradora / REIT | JPM, BAC, USB / PGR, TRV, AFL / PLD, AMT, O | los 9 coinciden, `method_not_implemented`                                                                                              |
| cíclica / commodity        | CAT, DE, F / XOM, FCX, NEM, DVN             | los 7 coinciden                                                                                                                        |
| alto crecimiento           | NVDA, AMZN, CRM                             | NVDA coincide; AMZN (×1,39) y CRM (×1,32) crecen por debajo del 15 % y salen maduras                                                   |
| pérdidas                   | MRNA, CRL, INCY                             | MRNA se abstiene (falta cobertura de intereses para descartar distress); CRL e INCY ya no tienen pérdidas persistentes y salen maduras |
| holding                    | L                                           | aseguradora: su SIC es `6331`                                                                                                          |
| distress                   | CCL, NCLH                                   | cíclicas: su distress fue 2020–2022 y hoy la cobertura supera 2                                                                        |

21 de 29 coinciden. Las 8 diferencias son de tiempo o de SIC, no de una regla
mal escrita: la etiqueta del owner nombra un evento dentro de la ventana y el
selector clasifica al corte. Se conservan como referencia para la próxima versión
de los umbrales.

### `F3-02`: perfil de completitud

`completeness-profile-1.0.0` mide sobre la serie anual qué existe para valuar la
empresa. Cada comprobación sale `met`, `partial`, `missing` o `not_evaluated`,
con lo que faltó nombrado; un dato ausente nunca se completa con cero.

| Comprobación             | `met` exige                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `structural_inputs`      | ventas, EBIT (o resultado antes de impuestos más intereses), impuesto y acciones diluidas del último ejercicio |
| `history_years`          | 5 ejercicios consecutivos con ventas y EBIT (`partial` desde 3)                                                |
| `cash_and_debt`          | caja y alguna partida de deuda en el último balance                                                            |
| `leases`                 | pasivo por arrendamientos operativos                                                                           |
| `research_development`   | I+D publicada en 3 ejercicios (`missing` si nunca se publicó)                                                  |
| `reinvestment_inputs`    | capex y depreciación del último ejercicio                                                                      |
| `tax_rate_inputs`        | resultado antes de impuestos e impuesto                                                                        |
| `industry_mapping`       | la industria de Damodaran asignada (`F3-05`); `not_evaluated` hasta entonces                                   |
| `geographic_revenue_mix` | siempre `missing`: `companyfacts` publica hechos sin dimensiones y el mix por país no llega a la base          |

`structural_inputs` reemplaza al preflight booleano del selector. Medido el
2026-10-02 sobre la muestra del gate: impuestos y arrendamientos en las 30;
historia de cinco años en 22 (las otras ocho son financieras o extractivas sin
EBIT publicado); capex en 12, porque emisores como Amazon lo publican con
conceptos que `sec-core-concepts-3.0.0` no selecciona. Ese hueco es de la
selección, no de la empresa, y queda para la normalización de la Fase 4.

### `F3-03`: nivel de rigor en la corrida

`rigor-level-1.0.0` deriva el nivel de la tabla de arriba desde la selección y el
perfil de completitud:

| Nivel         | Exige                                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| `unsupported` | la selección no admitió el método, o falta un insumo estructural             |
| `full`        | las nueve comprobaciones `met`, mix geográfico incluido                      |
| `standard`    | insumos estructurales, tres años de historia como mínimo e industria mapeada |
| `screening`   | el resto                                                                     |

El nivel viaja con `degradedBy` —las comprobaciones que impidieron el siguiente,
o `selection.<motivo>`— y con las aproximaciones que obliga a declarar:
`country_risk_by_domicile` sin mix geográfico, e `invested_capital_not_reconstructed`
en `screening`.

La corrida lleva la evaluación entera: `ValuationInput.assessment` contiene
selección, completitud y rigor, y entra en el `input_hash`. Tres policy checks
nuevos la cierran: `method_selection_admits_run` (el perfil y el método son los
que el selector eligió), `rigor_derived_from_completeness` (el motor **recalcula**
el rigor y rechaza uno escrito a mano) y `rigor_admits_valuation` (un nivel
`unsupported` no valúa). La versión metodológica pasa a `0.3.0` y la corrida de
referencia de `FixtureCo` cambia de hashes: su evaluación es declarada y su
rigor, derivado, es `screening`.

Medido el 2026-10-02 sobre la muestra: las ocho maduras quedan en `screening`
sólo por `industry_mapping`, que llega con `F3-05`; las 22 restantes son
`unsupported` con su motivo.

### `F3-04`: datasets Damodaran versionados

La [ADR 0032](../architecture/adr/0032-damodaran-reference-datasets.md) incorpora
cuatro tablas de Damodaran como **releases** fechadas: betas por industria de
EE. UU., riesgo país, ERP implícita histórica y rating sintético por cobertura.
`pnpm damodaran:record` baja cada página con una request, la verifica contra sus
encabezados y guarda las filas normalizadas; la misma publicación no escribe nada
y otra supersede a la vigente en la observación.

La disponibilidad es la observación, no el mes que la página escribe: la tabla de
riesgo país corrige filas a mitad de ciclo, y fecharla en enero sería look-ahead.
Un costo de capital anterior a la primera captura no tiene parámetros y lo
declara. La ERP es la implícita de inicio de año junto con la tasa del bono del
Tesoro de la misma fila; la serie mensual sólo existe en `.xlsx` y no entra.

### `F3-05`: industria del dataset de betas

`sic-damodaran-industry-1.0.0` lleva cada SIC de la lista oficial de la SEC a las
industrias de `damodaran.betas-us` que ese código puede ser. Con una sola
candidata, la empresa queda mapeada; con varias, la evaluación devuelve
`ambiguous` y **nombra las candidatas** en vez de elegir una. El SIC no
distingue lo que Damodaran separa: el 6021 es banco money center o regional, el
7372 tres industrias de software, el 6798 REIT o REIT minorista.

Una ambigüedad sólo se resuelve con una declaración del owner, escrita por CIK y
con motivo, en `declared-industry-assignments.ts`; el archivo arranca vacío. La
industria se valida contra la release de betas visible al corte: una que la
release no tiene es `unmapped` con `industry_not_in_release`.

`industry_mapping` de la completitud toma el estado del mapeo, así que una
empresa mapeada puede llegar a `standard`. Medido el 2026-10-02 sobre la muestra:
14 mapeadas y 16 ambiguas; Apple y Johnson & Johnson llegan a `standard` y
declaran `country_risk_by_domicile`, y las seis maduras con SIC ambiguo quedan
en `screening` hasta una declaración.

### `F3-06`: costo de capital bottom-up

`cost-of-capital-1.0.0` construye el WACC con nueve parámetros fechados de las
releases de Damodaran, cada uno con su release, fila y campo:

| Componente       | Regla                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Libre de riesgo  | tasa del bono del Tesoro de la última fila de ERP implícita menos el default spread del soberano de la moneda (EE. UU. es Aa1)                                                      |
| Beta             | desapalancada y corregida por caja de la industria mapeada, reapalancada con `βL = βU × (1 + (1 − t) × D/E)` a la D/E de mercado de la industria                                    |
| Costo del equity | `rf + βL × (ERP implícita + CRP del país del listing primario)`                                                                                                                     |
| Costo de deuda   | `rf +` spread del rating sintético por cobertura de intereses (tabla de no financieras grandes, piso inclusivo) `+` default spread del país, con escudo a la tasa marginal del país |
| Pesos            | los de la D/E objetivo de la industria                                                                                                                                              |
| Terminal         | beta 1 con la misma estructura                                                                                                                                                      |

Sin industria mapeada, sin cobertura de intereses en la ventana o en una moneda
distinta del dólar, el costo de capital no se construye y nombra lo que falta.
Un banco, una aseguradora o un REIT no recibe WACC: se valúan sobre el equity.

`ValuationInput.costOfCapital` lleva el objeto entero y el policy check
`wacc_built_from_components` lo **recalcula** desde sus parámetros: el primer
período tiene que arrancar en el WACC, el terminal en el WACC terminal y ningún
período salirse del camino entre los dos. La versión metodológica pasa a `0.4.0`;
el WACC de `FixtureCo` se construye con releases sintéticas que dan el mismo 9 %,
así que su valor por acción no cambia y sus hashes sí.

Medido el 2026-10-02: Apple 9,75 % (terminal 8,19 %), Johnson & Johnson 7,86 %.
Apple dejó de publicar intereses en 2024; su rating sintético sale de la
cobertura de 2023 y lo declara (`coverage_from_earlier_fiscal_year`).

### `F5-05`: riesgo país ponderado por operaciones

`cost-of-capital-1.1.0` ([ADR 0034](../architecture/adr/0034-operations-weighted-country-risk.md))
reemplaza, en la prima del equity, el CRP del país del listing por el **CRP por
operaciones** cuando hay mix:

`CRP = Σ peso × CRP de la exposición`

- **Peso**: los ingresos de cada línea geográfica del 10-K sobre la suma de las
  geográficas, calculados por código desde la transcripción que la policy aceptó
  (`operations-mix-weights-1.0.0`), o los pesos que declaró el owner, que ganan
  siempre.
- **CRP de la exposición**: el de su fila, de país o de región, de la release de
  riesgo país del `.xlsx` de Damodaran. Varias filas se combinan por el PBI de
  cada una en la misma release (`regions_combined_by_gdp`); el resto del mundo es
  la combinación de las nueve regiones (`rest_of_world_as_global`).
- **Lo que no cambia**: el default spread y la tasa marginal siguen siendo del
  domicilio, porque la deuda la emite la casa matriz.

Sin mix, el costo de capital es el de `1.0.0` y declara
`country_risk_by_primary_listing`: la falta de mix nunca es un CRP cero. Una
clave del mix que la release no tiene deja el WACC sin construir y la nombra.
`costOfCapital.operationsExposure` lleva cada componente con su release, fila,
CRP y PBI, y `wacc_built_from_components` recalcula el CRP desde ahí.
`completeness-profile-1.1.0` da el mix geográfico por presente cuando hay mix al
corte. La versión metodológica pasa a `0.5.0`; `FixtureCo` no tiene mix, así que
su valor por acción no cambia y sus hashes sí.

Medido el 2026-10-16: nueve no financieras de la muestra llevan CRP por
operaciones en su WACC. Johnson & Johnson pasa de 7,86 % a 8,39 % (CRP 0,81 %
contra 0,22 % de EE. UU.) y su rigor sube de `standard` a `full`; ExxonMobil, de
5,10 % a 5,27 %.

### `F5-06`: decisiones cualitativas en el snapshot

`ValuationInput.qualitativeDecisions` (`qualitative-decisions-1.0.0`) congela lo
que movió la beta y el CRP, con lo que lo sostiene:

- **Industria**: la base (`sic`, `owner_declaration` o `ai_resolution`), la
  versión del mapeo, el SIC y sus candidatas. Una declaración del owner lleva
  fecha y motivo, sin ticker. Una resolución de la IA lleva su ID, las versiones
  de tarea, prompt, escalera y secciones, el modelo que respondió, el escalón, la
  confianza, el motivo, las citas y la evidencia **resumida**: documento,
  accession, aceptación, `sha256`, tamaño y si se truncó. El extracto no viaja:
  queda en `industry_resolution_evidence` y lo identifica su hash.
- **Mix de operaciones**: la declaración del owner con sus pesos exactos, o la
  propuesta aceptada con sus versiones, el 10-K, el ejercicio, las releases cuyas
  claves se ofrecieron, la unidad, el total impreso, los ingresos esperados, el
  modelo, **cada línea como se imprimió con su cita** y la evidencia resumida.

Los pesos del CRP se **derivan** de la decisión (`operations-mix-weights-1.0.0`) y
la evaluación construye el costo de capital desde ella. El check
`qualitative_decisions_drive_cost_of_capital` (`reject`) lo repite en cada
corrida: la industria del costo de capital es la de la decisión; las candidatas
son las de la tabla del SIC; el monto de cada línea sale de lo impreso y lo
impreso está en su cita; y fuente, propuesta, claves y pesos de
`operationsExposure` son los que la decisión deriva. Una corrida sin decisión de
industria se rechaza.

Así el snapshot se explica solo. `replayValuationRun` (`valuation-replay-1.0.0`)
vuelve a calcular una corrida guardada desde su snapshot, con su reloj y su ID, y
compara `input_hash`, `result_hash` y estado; `pnpm valuation:replay` lo hace sobre
`valuation_runs` sin construir el egress ni la capa IA y sin leer las tablas de
propuestas. El replay es del motor y la metodología vigentes: el schema fija
ambas versiones, así que una corrida de `0.5.0` no se lee con este código y
reproducirla pide el código de su versión. Hoy `valuation_runs` no tiene corridas
reales —la corrida por ticker es `F6-01`—, así que ninguna queda afuera. La
versión metodológica pasa a `0.6.0`. `FixtureCo` declara su
industria y no tiene mix, así que su valor por acción no cambia y sus hashes sí.

Medido el 2026-10-16 en una réplica de la base personal: las seis empresas con
industria **y** mix de la IA que tienen costo de capital —AMZN, CRL, INCY, CCL,
NCLH y XOM— se valuaron con supuestos de proyección declarados en un script de
evidencia (construirlos es `F6-01` y la Fase 4). Tres corridas `computed` y tres
`rejected`: CCL, NCLH y XOM no son `non_financial_mature`. Con
`industry_resolutions`, `operations_mix_*`, las releases de Damodaran y las
aserciones `damodaran-industry` vaciadas, y sin `OPENROUTER_API_KEY` ni
`SEC_USER_AGENT`, el replay reprodujo **seis de seis**. Un monto transcripto
editado en el JSONB guardado diverge en los dos hashes y en el estado. El
snapshot pesa entre 13,8 y 16,3 kB.

### `F4-01`: arrendamientos e I+D capitalizados

[ADR 0037](../architecture/adr/0037-lease-rd-capitalization.md).
`ValuationInput.capitalization` (`capitalization-bridge-1.0.0`) lleva los hechos
del ejercicio base —EBIT reportado, pasivo por arrendamientos, I+D de cada
ejercicio—, lo que derivan las dos reglas y el puente:

```text
lease_debt          = pasivo por arrendamientos operativos (ASC 842) al cierre base
imputed_interest    = lease_debt × pre_tax_cost_of_debt
research_asset      = Σ_{t=0..n-1} rd_{-t} × (n − t) / n
amortization        = Σ_{t=1..n}   rd_{-t} / n
adjusted_ebit       = ebit + imputed_interest + rd_0 − amortization
Δ invested_capital  = lease_debt + research_asset
Δ debt              = lease_debt              (claim leaseDebt del puente)
```

- **EBIT sin resultado operativo** (`ebit-from-pretax-1.0.0`, `F6-15`,
  [ADR 0054](../architecture/adr/0054-zero-debt-evidence-derived-ebit.md)):
  si el ejercicio base no publica `OperatingIncomeLoss`, el EBIT es el
  resultado antes de impuestos más los intereses de `interest-expense-1.0.0`
  (un neto de ingreso se resta). `capitalization.ebitDerivation` congela los
  hechos y la base, `ledger.ebit.basis` dice `pretax_plus_interest`, y
  `capitalization_recomputed` lo recalcula; con resultado operativo publicado,
  ninguno de los dos campos existe.
- **Arrendamientos** (`lease-capitalization-1.0.0`): el total publicado o la
  suma de sus dos partes del mismo cierre; una parte sola no es el pasivo. El
  interés va al costo de deuda antes de impuestos de la propia corrida.
- **I+D** (`rd-capitalization-1.0.0`): la vida sale de
  `rd-amortizable-life-1.0.0`, que asigna a cada una de las 96 industrias del
  dataset de betas una fila de la hoja de vidas de Damodaran (`R&DConv.xls`), con
  la fila citada; un test exige que cada vida sea la de su fila. Sin ajuste
  fiscal. Se capitaliza desde el 1 % de las ventas. Si no, queda reportada con
  `not_reported`, `rd_negative`, `industry_unassigned`, `life_not_declared`,
  `revenue_unavailable`, `immaterial` o `insufficient_history`; nunca se la
  completa con cero ni se acorta la vida.
- **Historia**: la ventana conserva diez ejercicios de I+D
  (`sec-history-5fy-2.0.0`), y la serie anual prefiere la I+D que excluye la
  adquirida en proceso (`annual-fundamentals-1.1.0`).

El check `capitalization_recomputed` recalcula todo desde los hechos, con la
industria y el costo de deuda de la corrida; exige que los hechos sean del
cierre base, y que la deuda por arrendamientos sea exactamente la claim
`leaseDebt`. El margen y la reinversión siguen siendo supuestos: el margen EBIT
ajustado del año base viaja al lado para que su base sea visible. FixtureCo no
tiene arrendamientos (claim declarada ausente) ni I+D, y su valor por acción no
cambia.

Medido el 2026-10-19 con `pnpm valuation:assess --offline`, que ahora imprime el
puente:

| Empresa | Arrendamientos (M) | I+D                                          | EBIT reportado → ajustado (M) |
| ------- | -----------------: | -------------------------------------------- | ----------------------------- |
| AAPL    |             12.490 | vida 5, activo 92.478                        | 133.050 → 142.532             |
| GOOGL   |             15.954 | vida 3, activo 109.113                       | 129.039 → 146.106             |
| NVDA    |              2.944 | vida 5, activo 38.022                        | 130.387 → 141.395             |
| INCY    |                 20 | vida 10, activo 9.936                        | 1.515 → 2.143                 |
| JNJ     |              1.400 | vida 10, activo 77.590 (I+D recurrente)      | no publicado                  |
| DE      |                314 | vida 10, activo 10.851                       | no publicado                  |
| F       |              2.402 | vida 10, activo 44.480                       | −9.169 → −6.842               |
| AMZN    |             89.252 | `not_reported`                               | 79.975 → 84.063               |
| XOM     |              6.834 | `immaterial` (0,36 %)                        | no publicado                  |
| MRNA    | sin costo de deuda | `insufficient_history` (10 de 11 ejercicios) | −3.074                        |
| CAT     | sin costo de deuda | vida 10, activo 10.506                       | 11.151 → 11.450               |

Sin costo de deuda (CRM, CAT, NEM, MRNA no tienen cobertura de intereses para
el rating sintético) los arrendamientos quedan `cost_of_debt_missing`.

### `F4-03`: normalización reported/adjusted

[ADR 0038](../architecture/adr/0038-reported-adjusted-normalization.md).
`ValuationInput.normalization` (`normalization-1.0.0`) lleva los hechos del
ejercicio base con provenance **y concepto**, lo que derivan cuatro reglas y un
libro de ajustes:

```text
debt                     = primera receta que cierra (reported-debt-1.0.0)
excess_cash              = caja + inversiones líquidas + títulos no corrientes
invested_capital         = equity + minority_interest + debt − excess_cash
invested_capital_adj     = invested_capital + Δ capitalización (F4-01)
ebit_adj                 = ebit + arrendamientos + I+D + cargos no recurrentes
nopat_adj                = ebit_adj × (1 − tasa efectiva, o la marginal)
roic_adj                 = nopat_adj / invested_capital_adj
sales_to_capital_adj     = ventas / invested_capital_adj
```

- **Deuda** (`reported-debt-1.0.0`): tres recetas que no se solapan, la
  primera que cierra; los arrendamientos financieros se suman salvo que la no
  corriente ya los incluya, y un préstamo igual al centavo a los vencimientos
  corrientes es el mismo saldo dos veces. Sin receta, `unresolved`.
  Desde `F6-15` (`reported-debt-1.1.0`, [ADR 0054](../architecture/adr/0054-zero-debt-evidence-derived-ebit.md)),
  sin receta y con la evidencia de `zero-debt-evidence-1.0.0` —cinco
  ejercicios sin préstamos ni partidas de la guardia (cronograma de
  vencimientos, pagarés, línea de crédito) distintas de cero, y con intereses
  nulos o con cobertura en la banda más alta de la tabla de la corrida—, la
  deuda son los arrendamientos financieros (`finance_leases_only`) o cero
  (`zero_with_evidence`, claim `declared_absent`). La evidencia viaja en
  `normalization.facts.zeroDebtEvidence` sólo cuando se usa, y el check
  `zero_debt_evidence_consistent` exige que su piso sea la banda que usó el
  costo de capital. Sin gasto de intereses en esos cinco ejercicios, la
  cobertura es el piso de la banda más alta (`no_interest_expense`,
  declaración `coverage_no_interest_expense`). La completitud `cash_and_debt`
  no se cumple, así que el rigor no llega a `full`.
- **Caja** (`excess-cash-1.0.0`): toda es excedente, títulos no corrientes
  incluidos.
- **Capital invertido** (`invested-capital-1.0.0`): lado de la financiación,
  con goodwill, al cierre del ejercicio base.
- **Tasa** (`base-tax-rate-1.0.0`): efectiva del año base; sin ella —resultado
  antes de impuestos no positivo o tasa fuera de `[0, 1]`—, la marginal.
- **Cargos** (`non-recurring-charge-1.0.0`): reestructuración y deterioro, un
  concepto por ejercicio, revertidos sólo si ninguno de los cuatro ejercicios
  anteriores tuvo uno.
- **Compensación en acciones**: gasto; el libro la declara `not_applied` con su
  monto.

Cada entrada del libro declara destino (`ebit`, `invested_capital`, `debt`),
estado, motivo, monto, ejercicio, regla con versión y las rutas de su
evidencia. Los ajustes de arrendamientos e I+D se toman de la capitalización.
El check `normalization_recomputed` (`reject`) recalcula todo desde los hechos
con las ventas, la tasa marginal y la capitalización de la corrida, exige cada
hecho de su cierre, y exige que `bridge.debt` y `bridge.excessCash` sean
exactamente la deuda y la caja derivadas; sin ellas la claim no puede ser
`reported`. Los ratios ajustados informan los supuestos, no los fijan.

Medido el 2026-10-19 con `pnpm valuation:assess --offline` sobre 20 no
financieras de la muestra (montos en millones):

| Empresa | Deuda (receta)                    | Caja excedente | Capital ajustado | Cargos                       | EBIT → ajustado   |
| ------- | --------------------------------- | -------------: | ---------------: | ---------------------------- | ----------------- |
| AAPL    | 99.909 (total + corto plazo)      |        132.420 |          146.190 | —                            | 133.050 → 142.532 |
| AMZN    | 81.577 (total + corto plazo)      |        123.029 |          458.865 | deterioro recurrente         | 79.975 → 84.063   |
| NVDA    | 8.468 (corriente + no corriente)  |         10.605 |          196.122 | —                            | 130.387 → 141.395 |
| CRM     | 14.974 (total + corto plazo)      |          7.327 |           78.079 | reestructuración recurrente  | 8.331 → 9.173     |
| XOM     | 43.537 (corriente + no corriente) |         10.681 |          306.316 | —                            | no publicado      |
| DVN     | 8.412 (duplicado excluido)        |          1.384 |           22.556 | deterioro de 254 revertido   | no publicado      |
| F       | `unresolved`                      |         38.487 |     sin resolver | deterioro de 9.435 revertido | −9.169 → 2.593    |

La deuda se resuelve en 14 de 20; Ford, Caterpillar, Deere, Incyte, Moderna y
Norwegian no publican sin dimensiones lo que una receta necesita, y no se
valúan hasta una declaración del owner con monto. FixtureCo deriva su deuda
(30 M) y su caja (12 M) de su balance sintético y conserva su valor por acción.

## Normalización

Implementada en `F4-03` (sección anterior) para el ejercicio base; la
normalización a lo largo de un ciclo es de `F4-06` (cíclicas).

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

`fcff-1.2.0` (`F4-02`) implementa las dos primeras. El check
`terminal_growth_versus_risk_free` (`reject`) exige
`terminal.growth <= costOfCapital.derived.riskFree`:

- **Qué libre de riesgo.** La que el costo de capital de la propia corrida
  deriva —el bono del Tesoro de la release de ERP implícita menos el default
  spread del soberano de la moneda—, no una constante del motor. Por eso está
  fechada, es la de la moneda de la valuación (`wacc_built_from_components` ya
  exige que el costo de capital esté en esa moneda y la recalcula desde sus
  parámetros) y un replay la lee del snapshot.
- **Borde inclusivo.** Crecer exactamente a la libre de riesgo es el caso límite
  que Damodaran admite; `g = rf + ε` se rechaza.
- **No reemplaza al buffer.** Con un WACC terminal muy alto el buffer admite
  cualquier `g`; esta regla no. Y con una libre de riesgo alta y un WACC bajo
  puede ocurrir lo inverso. Los dos checks corren siempre y cada uno nombra su
  motivo.
- **En la sensibilidad** el eje de WACC no mueve la libre de riesgo, así que la
  regla rechaza una columna entera con `terminal_growth_versus_risk_free`. Se
  evalúa antes que el buffer: una celda que viola las dos lleva el motivo
  económico, y la columna se lee con uno solo.

Medido el 2026-10-19 con `pnpm valuation:assess --offline`, que ahora imprime el
techo: la libre de riesgo en dólares de la release vigente es 3,96 % (AAPL, JNJ
y XOM comparten la release). La de `FixtureCo` es 4 %, su `g` es 2 % y su eje de
crecimiento llega a 4 %: ninguna celda nueva queda rechazada y su valor por
acción no cambia; cambian sus hashes, porque la versión del motor está en el
snapshot.

La versión del motor está en el esquema de la corrida: una corrida guardada con
`fcff-1.1.0` no se reescribe ni se migra —conserva su fila y sus hashes—, no se
lee con este código y reproducirla pide el código de su versión; nunca se la
recalcula en silencio con la regla nueva. La versión metodológica pasa a
`0.8.0`.

### Supervivencia y recupero

Desde `fcff-1.6.0` (`F4-05`, ADR 0040), el DCF es el valor **condicional a
seguir operando**. `failure-risk-1.0.0` toma la probabilidad acumulada a diez
años del rating sintético que ya deriva el costo de capital, en la release
conocida y vigente de `damodaran.failure-rates`. El horizonte estadístico es
siempre diez años —el que ilustra la hoja Ginzu—, aunque el forecast explícito
tenga otro largo; no es una tasa anual ni una probabilidad de la perpetuidad.

El parser `damodaran-failure-rates-1.0.0` lee sólo la tabla de rating de la
hoja `Failure Rate worksheet`: verifica encabezado, diez horizontes, los siete
grupos y probabilidades finitas entre cero y uno que no decrecen con el plazo.
No lee la tabla por edad del negocio que hay más abajo. Conserva las diez
columnas exactas en una release observada y usa `year_10` en la corrida.

Los signos `+` y `−` van al grupo amplio de la tabla: AAA, AA, A, BBB, BB, B
y CCC/C. `CCC`, `CC` y `C` comparten el último. No se interpola entre notches.
La tabla no tiene `D`: un **rating sintético** `D` no demuestra un default
observado y queda `synthetic_rating_unmapped`, nunca una probabilidad del
100 % inventada. El owner puede declarar otra probabilidad por CIK, con motivo
y fecha real de declaración (`declared-failure-probabilities.ts`), visible
sólo desde esa fecha. Dos declaraciones contradictorias al mismo instante se
rechazan como `owner_declaration_conflict`.

```text
going_concern_value = sum(pv_fcff) + pv_terminal_value
proceeds = 0.5 × max(reported_book_capital, 0)
enterprise_value = going_concern_value × (1 − p) + proceeds × p
```

El capital en libros es `normalization.investedCapital.reported`, antes de la
capitalización de I+D y arrendamientos. Un capital no positivo recupera cero
y declara `non_positive_book_capital`; un capital desconocido bloquea la
corrida. El puente a equity y el denominador se aplican después de este ajuste.
El WACC no se cambia para representar fracaso.

`ValuationInput.failureRisk` congela la selección: rating, horizonte, parámetro
con release/fila/campo/disponibilidad/registro, o la declaración del owner.
`failure_risk_recomputed` rechaza un rating, fila, sujeto, corte o probabilidad
incompatible y un capital sin resolver. `failureAdjustment` del resultado
expone DCF condicional, probabilidad, recupero, base y valor ponderado.
Bear, base, bull y cada celda de sensibilidad vuelven a aplicar la misma
probabilidad y el mismo capital sobre su propio DCF. `terminalValueShare`
sigue siendo concentración del **DCF condicional**, no del valor después de
recupero: el ajuste no debe falsear ese diagnóstico.

La metodología pasa a `0.12.0`; la fixture usa una probabilidad sintética cero
para conservar el valor por acción. Sus hashes cambian por el nuevo snapshot
y resultado. Ninguna corrida guardada se reescribe: el replay de una versión
anterior requiere su código, como en los incrementos previos.

### Puente EV-equity

```text
enterprise_value = going_concern_value × (1 − p) + proceeds × p
equity_value = enterprise_value
             + excess_cash
             + non_operating_assets
             - debt
             - lease_debt
             - minority_interest
             - other_claims
             - employee_options
value_per_share = equity_value / (shares_outstanding + unvested_units)
```

Las acciones deben ser positivas, ajustadas de forma compatible y fechadas. Una
claim faltante no se presume cero sin evidencia.

Desde `fcff-1.5.0` (`F4-05`, [ADR 0040](../architecture/adr/0040-failure-probability-employee-options.md),
`employee-equity-claim-1.0.0`) el denominador ya no son las acciones diluidas
del filing, que por treasury stock cuentan sólo las opciones en el dinero al
precio promedio y nada de su valor temporal. Como Damodaran:

- las **opciones vivas** se valúan con Black-Scholes, rendimiento de
  dividendos y el precio ajustado por dilución (`option-value-dilution-1.0.0`),
  con la volatilidad de cinco años de la serie de precios
  (`equity-volatility-1.0.0`) y la libre de riesgo de la corrida, y se restan
  como claim `employeeOptions`;
- el denominador son las **acciones en circulación** de la carátula más
  reciente (`shares-outstanding-cover-1.0.0`) más las **unidades no
  consolidadas** (RSU y PSU); las opciones no entran, porque ya restaron su
  valor;
- cantidades, strike, plazo y unidades los transcribe la IA de la nota de
  compensación en acciones del 10-K con cita literal, corroborados con el XBRL
  del mismo 10-K (`employee-equity-1.2.0`); el código escala, promedia y
  valúa. La transcripción aceptada se congela en el snapshot.

`employee_equity_recomputed` (`reject`) recalcula el valor de las opciones y el
denominador con la libre de riesgo de la corrida y exige que la claim del
puente sea exactamente ese valor. Medido sobre seis empresas reales con su
cotización de octubre de 2026: las opciones restan del 0,01 % (American Tower)
al 6,05 % (Moderna) de la capitalización, y las unidades suman hasta un 4,64 %
al denominador (Incyte).

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

Implementado en `fcff-1.4.0` ([ADR 0039](../architecture/adr/0039-coherent-valuation-scenarios.md),
`scenario-set-1.0.0`):

- La base es la corrida misma; bear y bull viajan en el mismo snapshot
  (`ValuationInput.scenarios`) con una tesis y una lista de drivers, cada uno
  con valor y motivo: crecimiento, margen y reinversión por período (un valor
  por período, `null` deja el de la base, en la convención del período) y `g`,
  margen y retorno sobre el capital terminales.
- No mueven el costo de capital, la tasa impositiva, los hechos del ejercicio
  base ni el puente: la incertidumbre de tasa es la sensibilidad.
- Cada escenario se materializa como un snapshot completo y pasa por los
  mismos checks y el mismo motor que la base. Un `reject` en un escenario
  rechaza la corrida con rutas `scenarios.<clave>:<ruta>`; un
  `require_review`, la deja en revisión.
- No hay probabilidades: el rango no se pondera ni produce un valor esperado.
- `scenario_value_order` pide revisión si `bear <= base <= bull` no se cumple.

FixtureCo: 9,54 / 13,55 / 17,56 USD por acción, con la base intacta.

La sensitivity WACC/g:

- mantiene constantes los demás inputs;
- rechaza celdas donde `g` supera la libre de riesgo de la corrida
  (`terminal_growth_versus_risk_free`) y, después, donde WACC no supera
  `g + buffer` (`terminal_growth_versus_wacc`);
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

| Check                            | Resultado mínimo                                                      |
| -------------------------------- | --------------------------------------------------------------------- |
| WACC versus crecimiento terminal | `reject` si viola el buffer                                           |
| crecimiento terminal versus rf   | `reject` si `g` supera la libre de riesgo de la corrida               |
| normalización                    | `reject` si el libro o deuda y caja del puente no salen de sus hechos |
| acciones del denominador         | `reject` si no son positivas o comparables                            |
| valores finitos                  | `reject` para NaN/Infinity/división inválida                          |
| moneda y unidad                  | `reject` si se combinan sin conversión trazable                       |
| reinversión y crecimiento        | `require_review` o `reject` si no son coherentes                      |
| margen terminal                  | `require_review` fuera del rango sectorial sin evidencia              |
| tax rate y leverage              | `require_review` fuera de rango defendible                            |
| exposición país                  | `reject` si los pesos no suman 100% dentro de tolerancia              |
| decisiones cualitativas          | `reject` si industria o pesos no salen de la decisión                 |
| freshness e inputs               | `reject` o `require_review` según el método                           |
| peso del terminal                | diagnóstico visible si excede el umbral versionado                    |
| drivers de escenario             | `reject` si no cubren los períodos, la convención o no cambian nada   |
| orden de escenarios              | `require_review` si no se cumple `bear <= base <= bull`               |
| opciones y unidades              | `reject` si su valor o el denominador no salen de la transcripción    |
| supuestos derivados              | `reject` si períodos o terminal no salen de `derivedAssumptions`      |

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

La corrida guarda la propuesta como parte del snapshot de entrada
(`qualitativeDecisions`, desde `F5-06`), no como una llamada que se repite. Un
replay un año después lee la propuesta persistida y reproduce el mismo hash sin
volver a contactar al modelo ni leer las tablas de propuestas. Sin eso, la
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
