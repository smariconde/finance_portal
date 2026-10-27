# ADR 0061: snapshot financiero derivado para el job por ticker

- Estado: aceptado para `F6-20`; valuación real pendiente de declaración del owner
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

El owner decidió que la distribución y las revisiones de capital regulatorio,
calidad de activos y clean surplus sean explícitas, y que entren por archivo
privado registrado con CLI. El archivo también admite los dos saldos de
patrimonio común transcritos cuando `companyfacts` no los publica.

## Decisión

`derived-financial-equity-1.0.0` prefiere patrimonio común directo de dos
ejercicios y utilidad común anual de la SEC. Cuando falta uno de los saldos,
usa sólo un par declarado por el owner para esos ejercicios, con documento,
fecha de registro, moneda y marca de transcripción. El ROE es utilidad común
del último ejercicio dividida por el promedio de ambos saldos; moneda ausente
o distinta, saldo no positivo y utilidad negativa impiden el snapshot. La
utilidad común nunca se sustituye por utilidad neta total.

`derived-financial-risk-1.0.0` toma la beta **de equity** de la industria de
Damodaran, el Treasury menos el spread soberano para la libre de riesgo, la ERP
implícita y el CRP de EE. UU. Cada release queda identificada en los hechos del
snapshot; se exige listing estadounidense. No aplica Hamada a los depósitos ni
usa la tabla de ratings sintéticos de no financieras. Sin release, fila, campo
o industria mapeada no hay costo de equity.

La declaración privada `financial-declaration-1.0.0` se registra append-only
en PostgreSQL con corte `available_at`; el job lee la última para la entidad y
el ejercicio que existía al `known_at` del pedido. El CLI valida forma,
tamaño, payout entre 0 y 1, textos de revisión y fuente antes de escribir. Un
archivo no se commitea ni el render lo lee. Si los hechos bastan para
seleccionar el método pero falta la declaración, el snapshot nombra
`financial_declaration_missing`. Si también faltan hechos financieros, el
selector devuelve `missing_required_input`. En ambos casos no calcula valor.

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

JPM sigue sin una valuación real: el owner no entregó los saldos comunes ni la
declaración de distribución y revisión. Eso es un faltante de entrada, no una
señal de que el banco tenga patrimonio común cero. El contrato sintético cubre
la derivación, el rechazo de alteraciones y la lectura; PostgreSQL prueba que
una declaración futura no entra en un corte anterior. El gate completo y el
walkthrough real deben constar en el backlog antes de cerrar `F6-20`.

No se agrega proveedor, egress, modelo, Route Handler, Server Action ni
secreto. Migraciones `0037` y `0038` tienen rollback que se niega si perdería
declaraciones o corridas referenciadas. La fuente de referencia mantiene sus
derechos de uso y no se guarda su archivo; la transcripción del owner vive
solo en la base privada.
