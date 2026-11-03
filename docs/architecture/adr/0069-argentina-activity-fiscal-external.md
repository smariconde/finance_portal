# ADR 0069: actividad, fiscal y sector externo con bases compatibles

- Estado: propuesta; falta cerrar los derechos de `argentina-series-tiempo` y
  verificar las series concretas contra sus publicaciones originales.
- Fecha: 2026-11-03
- Alcance: `F9-04`, después de `F9-07`.
- Relacionadas: [ADR 0065](0065-bcra-monetary-catalog-vintages.md),
  [ADR 0066](0066-macro-real-and-dollar-transformations.md),
  [contrato point-in-time](../../data/point-in-time-contract.md).

## Contexto

La [API oficial de Series de Tiempo](https://www.argentina.gob.ar/datos-abiertos/api-series-de-tiempo)
reúne indicadores de distintos organismos y permite consultarlos en JSON. Su
[búsqueda](https://apis.datos.gob.ar/series/api/search/?q=emae) expone para cada
campo ID, frecuencia, unidad, fecha inicial/final, dataset, editor y fuente. La
misma actividad puede existir como serie original, desestacionalizada o tendencia,
en distintas bases. La API es un distribuidor: la ficha y metodología del
organismo que produjo el indicador siguen siendo la autoridad semántica.

La revisión inicial encontró licencia **CC BY 4.0** en los datasets candidatos
de [EMAE](https://www.datos.gob.ar/ca/dataset/sspm-estimador-mensual-actividad-economica-emae-base-2004),
[intercambio comercial](https://datos.gob.ar/dataset/sspm-intercambio-comercial-argentino)
y [esquema fiscal base caja](https://www.datos.gob.ar/id/dataset/sspm-esquema-ahorro---inversion---financimmiento-sector-publico-nacional-base-caja).
Es evidencia favorable para el uso personal con atribución, pero falta elegir
las distribuciones exactas y verificar que la serie de PIB comparta escala y
período con el numerador fiscal.

El [registro](../../data/source-registry.md) conserva
`argentina-series-tiempo` en `rights_review_pending`. El portal es personal, pero
una URL pública y una API funcional no demuestran por sí solas permiso para la
persistencia requerida. No se habilita egress ni presupuesto hasta documentar el
derecho por dataset y la decisión del owner.

## Decisión propuesta

1. Declarar un set pequeño: EMAE original y desestacionalizado de INDEC;
   resultado primario y financiero del sector público nacional, más PIB nominal
   anual; exportaciones e importaciones de bienes y saldo publicado por INDEC.
   Cada ID se fija sólo después de conciliar nombre, unidad, cobertura y
   metodología con la publicación original. Un ID de búsqueda no autoriza su
   ingestión.
2. Mantener cada variante estacional y cada base de índice como una serie
   separada. Un rebasing o quiebre abre `segment`; no se calcula variación entre
   segmentos sin un empalme publicado y versionado.
3. Guardar una revisión por punto con `periodOn`, `availableAt`, `recordedAt`,
   `revision`, `segment` y corrida. Si la API no da publicación/revisión fechada,
   `availableAt` es la observación de la descarga, nunca el fin del período.
   `as_known` público y `system_recorded` siguen siendo lecturas distintas.
4. Calcular en lectura, con versión `argentina-indicator-1.0.0`, sólo operaciones
   cuyos insumos ya tienen definición compatible. La variación mensual de
   actividad usa la serie desestacionalizada **publicada**, meses contiguos y la
   misma base. El saldo comercial resta exportaciones e importaciones del mismo
   mes, moneda, unidad, base y ajuste. El ratio fiscal suma los doce meses
   originales del año calendario y divide por PIB **nominal de ese mismo año**
   en la misma moneda y escala; el denominador faltante o cero produce un nulo
   con motivo. Un resultado primario y uno financiero son conceptos distintos.
5. La lectura de cada serie declara su propia fecha, metodología y última
   revisión. Ningún ratio hereda una fecha global del tablero.

## Incremento implementado

`src/modules/macro-series/domain/argentina-indicator.ts` contiene el contrato
validado y las tres lecturas puras. Los casos sintéticos prueban revisión tardía,
base, estacionalidad, año incompleto, moneda, cero, negativos y valores no
finitos. Aún no hay adaptador, migración, descarga real ni página: esos elementos
requieren cerrar el gate de fuente y conciliar las series declaradas.

## Condiciones para aceptar y continuar

- Revisar licencia y retención por los datasets elegidos; registrar la decisión
  en `provider-use-matrix.md` y `source-registry.md`.
- Medir el cable real por ID, metadata, paginación, nulos y revisiones; escribir
  fixtures sintéticas de contrato y un ADR aceptado con el set fijado.
- Incorporar la fuente a allowlist, derechos y presupuesto diario de PostgreSQL
  antes de abrir el primer socket de la aplicación.
- Conciliar los últimos puntos y los quiebres con la publicación del organismo.
