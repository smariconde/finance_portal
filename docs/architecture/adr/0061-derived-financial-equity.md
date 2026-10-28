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
