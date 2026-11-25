# ADR 0061: snapshot financiero derivado para el job por ticker

- Estado: aceptado para `F6-20`; corregido el 2026-10-28 para entrada automática
- Fecha: 2026-10-27
- Relacionadas: [ADR 0041](0041-financial-equity-excess-return.md),
  [ADR 0045](0045-ticker-valuation-job.md),
  [ADR 0059](0059-derived-cycle-normalization.md)

## Contexto

El motor `excess-return-1.0.0` admitía sólo un snapshot privado completo por
CLI. El job por ticker clasificaba JPM como banco pero devolvía
`missing_required_input` para patrimonio común, ROE y costo de equity.

Una ingesta medida de JPM con `sec-core-concepts-9.0.0` el 2026-10-27 encontró
utilidad disponible a accionistas comunes y patrimonio total, pero no los
conceptos `CommonStockholdersEquity`, `PreferredStockValue` ni
`PreferredStockCarryingValue`. El patrimonio total de USD 362.438 millones al
cierre 2025 incluye derechos que no son necesariamente comunes. No se toma
como patrimonio común ni se presume que las preferentes son cero.

El owner aclaró el 2026-10-28 que la app debe calcular sin archivos ni carga
manual. Las distribuciones y las revisiones de capital regulatorio, calidad
de activos y clean surplus deben quedar explícitas en la corrida, derivadas
del filing y con su fuente.

## Decisión

`derived-financial-equity-1.1.0` prefiere patrimonio común directo de dos
ejercicios y utilidad común anual de la SEC. Cuando faltan los saldos en
`companyfacts`, `financial-filing-evidence-1.1.0` lee las tablas visibles
del 10-K, concilia patrimonio total menos preferentes para ambos ejercicios
y utilidad neta menos dividendos preferentes y asignación a valores
participantes para la utilidad disponible a acciones comunes de JPM.
Para PRU, el 10-K declara que no hay preferentes emitidas; el lector concilia
el patrimonio de la controlante con los intereses no controlantes y la utilidad
de la controlante con los premios en acciones participantes de la tabla EPS.
El ROE es utilidad común del último ejercicio dividida por el promedio de
ambos saldos; moneda ausente
o distinta, saldo no positivo y utilidad negativa impiden el snapshot. La
utilidad común nunca se sustituye por utilidad neta total.

`derived-financial-risk-1.0.0` toma la beta **de equity** de la industria de
Damodaran, el Treasury menos el spread soberano para la libre de riesgo, la ERP
implícita y el CRP de EE. UU. Cada release queda identificada en los hechos del
snapshot; se exige listing estadounidense. No aplica Hamada a los depósitos ni
usa la tabla de ratings sintéticos de no financieras. Sin release, fila, campo
o industria mapeada no hay costo de equity.

El job pide `submissions` y el 10-K a través del egress medido, con derechos
de SEC y corte `known_at`. Del mismo filing obtiene dividendos comunes,
recompras netas y payout; exige que la distribución sea no negativa y no
supere la utilidad común. Registra en el snapshot el contraste de CET1 con
su requisito, la razón de reservas crediticias y el residuo de la variación
del patrimonio común. Si faltan tablas o alguna conciliación falla, no calcula
valor; el selector puede quedar en `missing_required_input` y, si ya tenía
base financiera directa, el armado nombra `financial_filing_evidence_missing`.
No conserva el HTML
en la base. `financial_declaration_missing` se mantiene sólo para leer jobs
anteriores. La tabla y el CLI de declaraciones se retiran en `0039`; la
migración se niega si encuentra una declaración existente.

El job arma `excess-return-1.1.0` / `financial-equity-1.1.0` con diez años.
El primer ROE y la primera beta son los medidos; ambos convergen linealmente
al costo de equity terminal y beta 1 en el año 10. La distribución explícita
se mantiene durante los diez años. En el terminal, ROE iguala Ke y el
crecimiento iguala la libre de riesgo no negativa; no se agrega un valor de
franquicia perpetuo sin evidencia. No hay bear/bull ni sensibilidad derivados:
atribuirles probabilidades o rango requeriría otra decisión del owner. El
motor y la metodología `1.0.0` conservan su replay.

## Corte y presentación

El `as_of` de la corrida es el último cierre guardado hasta el pedido. El
patrimonio puede venir de un cierre anual hasta 540 días anterior y las
acciones de una carátula hasta 180 días anterior. Cada fecha original se
conserva; el policy check rechaza una antigüedad mayor, un hecho posterior al
corte, una moneda distinta y un ROE del primer año que no reproduzca utilidad
común / patrimonio común promedio. Es una ampliación versionada respecto de
la exigencia de fecha exacta de ADR 0041, necesaria porque la primera release
de Damodaran observada en este runtime es posterior al cierre fiscal 2025.

La página lee la unión persistida y muestra valor, precio y su relación sólo
cuando fecha, moneda y base de acciones son comparables. Proyección y
procedencia se presentan en tabla semántica. El modelo sigue `experimental`,
rigor `screening` y estado `requires_review` cuando calcula. Una corrida
rechazada y un faltante muestran motivo; no hay recomendación.

## Límites y verificación

JPM y PRU produjeron corridas reales `requires_review` desde sus 10-K 2025,
sin datos del owner. Los extractos reducidos de ambos filings quedaron
congelados como fixtures SEC con URL, fecha, bytes y hashes. PRU usa el RBC
medido de PICA a 2024, último presentado en su 10-K, frente al umbral de
acción de 100%; la revisión dice expresamente que el RBC 2025 aún no estaba
presentado y que PICA es una subsidiaria. El rigor del job es `screening`,
sin exigir los controles estructurales de FCFF a un método de patrimonio.
El lector es deliberadamente estricto: otros estados no conciliables quedan
sin valor hasta ampliar el parser con evidencia propia.

No se agrega proveedor, modelo, Route Handler, Server Action ni secreto. El
egress SEC existente y sus derechos controlan las dos peticiones. Los
filings completos se usan en memoria y no se guardan como payload crudo.

## Enmienda del 2026-11-25: la base desde el XBRL del 10-K (`F6-50`)

**Problema.** Berkshire Hathaway se clasifica aseguradora (SIC 6331) y no llegaba
a una corrida: no publica `CommonStockholdersEquity` ni la utilidad disponible
a comunes, y `financial-filing-evidence-1.1.0`, que lee las tablas HTML de JPM y
PRU por sus rótulos, devuelve `table_missing_or_ambiguous`. Tampoco paga en
acciones, así que el armado se detenía en `employee_equity_not_proposed`.
Decisión del owner (2026-11-25): opción (a), aseguradora en modo screening;
holding/SOTP sigue diferido.

**Decisión 1 — `financial-xbrl-evidence-1.0.0`.** Si el lector HTML no reconoce
el filing, la misma evidencia sale del instance XBRL del mismo 10-K (una lectura
medida más), con evidencia y nunca por ausencia:

- patrimonio común = `StockholdersEquity` de la controlante a los dos cierres,
  sólo si el filing publica las preferentes en cero
  (`preferred_not_evidenced`, `preferred_outstanding`);
- utilidad común = `NetIncomeLoss`, sólo si algún EPS básico por sus acciones la
  reproduce dentro del redondeo impreso: dividendos preferentes o una
  asignación a valores participantes la romperían;
- dividendos y recompras del flujo de fondos; uno no publicado es cero sólo si
  el patrimonio limpio cierra a 2 % de la utilidad o menos
  (`distribution_unsupported`);
- capital y superávit estatutario, pasivo por siniestros o previsión de pérdidas
  crediticias y el residuo del patrimonio limpio, como diagnósticos fechados
  (`regulatory_capital_missing`, `asset_quality_missing` sin ellos). El texto del
  capital dice que es de las aseguradoras y que el patrimonio valuado es el
  consolidado del grupo.

Los hechos congelados llevan la regla en sus `qualityFlags`; el motor, la
metodología y el snapshot no cambian. JPM y PRU siguen por las tablas HTML.

**Decisión 2 — opciones no restadas, nombradas.** Sin transcripción aceptada ni
opciones en el XBRL, el armado financiero usa la misma base `not_subtracted` que
el FCFF (`F6-16`, ADR 0055): el valor por acción es un techo y se dice. Su
disponibilidad es la del 10-K del ejercicio.

**Medido en una réplica con el worker real.** BRK-B: patrimonio 717.419 M
(649.368 M el previo), utilidad 66.968 M (46.563 × 1.438.223 acciones
equivalentes A), sin dividendos ni recompras en 2025 y patrimonio limpio con un
residuo de −53 M (0,08 % de la utilidad); ROE 9,8 % contra un costo de 8,4 %;
393,38 por acción B contra un cierre de 577,21, rigor `screening`. JPM y PRU no
cambian de camino. El instance de BRK pesa 13,5 MB y bajó en 12 s; el
`deadline_exceeded` del primer intento fue una SEC lenta, no el tamaño.

## Enmienda del 2026-11-25: corredores y bancos de inversión (`F6-53`)

**Problema.** El SIC 6211 («Security Brokers, Dealers & Flotation
Companies») no tenía perfil: `sec-sic-profile-2.0.0` dejaba sin evidencia a los
perfiles financieros de un código de la división financiera que no mapeaba, y
HOOD, SCHW, GS, MS, RJF e IBKR frenaban en `missing_classification_evidence`.
Medido con doce pedidos a la SEC: los seis mapean a «Brokerage & Investment
Banking», para la que Damodaran no publica un ROC (la trata como financiera);
ninguno publica `CommonStockholdersEquity`; tres tienen preferentes (GS, SCHW,
MS) y GS y SCHW devolvieron más que su utilidad en 2025 (103 % y 110 %).

**Decisión 1 del owner — perfil `broker_dealer` con exceso de retorno.**
`sec-sic-profile-3.0.0` afirma `broker_dealer` para el 6211 y lo niega donde
niega a los demás perfiles financieros; comparte el primer nivel de precedencia
con banco, aseguradora y REIT y se valúa con este mismo modelo, experimental y
`screening`. Su selección lleva versión propia (`method-selection-0.7.0`) para
que las de los demás perfiles conserven su hash, y un `broker_dealer` sin
evidencia se lee ausente cuando la de `bank` es negativa: es lo que afirmaba la
`2.0.0`, y así los snapshots guardados con ella se reproducen igual. Un
broker-dealer va directo al XBRL del 10-K; el lector HTML sigue siendo de JPM y
PRU. Migración `0058`: el check de `valuation_jobs` admite el perfil.

**Decisión 2 del owner — payout del trienio con tope en uno**
(`financial-payout-three-years-1.0.0`). Dividendos comunes y recompras de los
tres ejercicios del 10-K sobre su utilidad común; por encima de uno se lleva a
uno y se nombra (`payoutCapped`), porque más que toda la utilidad achicaría el
patrimonio sin fin. Se congela en `derivedFinancial.payoutBasis` sólo cuando se
usa —los snapshots anteriores conservan su hash— y el policy check exige que su
primer ejercicio sean los hechos del año base y que el payout sea el que el
trienio implica. Aplica a la lectura XBRL; las tablas HTML de JPM y PRU siguen
con el año base.

**`financial-xbrl-evidence-1.1.0`.** Generaliza la `1.0.0`, siempre con
evidencia en vez de ausencias:

- patrimonio de la controlante como `StockholdersEquity` o, sin él, el total
  con no controlantes menos `MinorityInterest` del mismo cierre (HOOD);
- preferentes publicadas a los dos cierres —`us-gaap` o el mismo nombre en la
  extensión del filer, como los 9.750 M de `ms:PreferredStockCarryingValue`— y
  restadas; cero con acciones publicadas en cero o con un estado de patrimonio
  cuyos componentes suman la controlante sin columna de preferentes;
- utilidad común `NetIncomeLossAvailableToCommonStockholdersBasic` (la neta,
  sólo sin preferentes) que el EPS básico reproduce dentro del redondeo impreso,
  o a 1 % o menos nombrando el desvío (`participating_allocation_unpublished`):
  GS no etiqueta su asignación a valores participantes y deja 55,2 M;
- distribuciones por escaleras de conceptos con nombre. Un concepto que el 10-K
  usa otros años es evidencia de que la partida existe: el ejercicio que falta
  se lee de `companyconcept` (`sec-companyconcept-1.0.0`, un pedido más) desde un
  10-K presentado antes del último —MS etiqueta sus recompras de 2023 sólo en el
  de 2024—. Sin concepto en ningún año, los dividendos son cero si los
  resultados acumulados ruedan exactamente con la utilidad (HOOD), y dividendos o
  recompras si el patrimonio limpio cierra a 2 % (BRK);
- capital regulatorio: estatutario (aseguradoras) o CET1 con su mínimo, por
  miembro y hasta dos ejes (GS lo publica por entidad y por método). Para un banco
  o una aseguradora sus diagnósticos siguen siendo exigidos; para un
  broker-dealer la ausencia se nombra en el texto, porque HOOD no etiqueta el net
  capital de sus subsidiarias.

**Fuera.** IBKR queda en `distribution_unsupported`: no recompra, no publica
concepto de recompras y los canjes de su estructura Up-C (la sociedad cotizante
tiene el 25 % de IBG LLC) mueven el patrimonio de la controlante sin pasar por
el resultado, así que el patrimonio limpio no cierra. Otros códigos de la
división financiera sin perfil (6199, 6282, 6411, 6200) siguen sin evidencia.

**Medido en una réplica de la base personal con el worker real** (descarga e
IA; cierre del 2026-11-25, Ke 9,13 % con la beta de la industria, 1,17):

| Ticker | Patrimonio común (M) | ROE    | Payout del trienio | Valor  | Cierre | P/V  |
| ------ | -------------------- | ------ | ------------------ | ------ | ------ | ---- |
| HOOD   | 9.140                | 22,0 % | 55,1 %             | 15,23  | 65,78  | 4,32 |
| SCHW   | 42.662               | 20,6 % | 85,3 %             | 34,50  | 93,45  | 2,71 |
| GS     | 109.819              | 14,9 % | 100,6 % → 100 %    | 456,43 | 801,03 | 1,76 |
| MS     | 101.882              | 16,5 % | 80,9 %             | 82,82  | 167,55 | 2,02 |
| RJF    | 13.128               | 18,5 % | 69,4 %             | 93,45  | 162,84 | 1,74 |

Las cinco quedan `requires_review` por el rótulo experimental y el riesgo país
por domicilio, como JPM y PRU. El modelo converge el ROE al costo en diez años y
no paga una franquicia perpetua: el precio de los cinco descuenta más, y HOOD
—seis veces su patrimonio— es el caso extremo. Un `EgressBlockedError` en
SCHW y en MS durante una segunda tanda fue transitorio y pasó al repetirlo.
