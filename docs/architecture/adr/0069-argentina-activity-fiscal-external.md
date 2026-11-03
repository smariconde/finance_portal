# ADR 0069: actividad, fiscal y sector externo con bases compatibles

- Estado: aceptada
- Fecha: 2026-11-03
- Alcance: `F9-04`, después de `F9-07`.
- Relacionadas: [ADR 0065](0065-bcra-monetary-catalog-vintages.md),
  [ADR 0066](0066-macro-real-and-dollar-transformations.md),
  [ADR 0020](0020-source-daily-budget-kill-switch.md),
  [ADR 0033](0033-ai-layer-industry-resolution.md) (credencial que agrega la
  puerta), [contrato point-in-time](../../data/point-in-time-contract.md),
  [runbook](../../runbooks/indec-token.md).

## Contexto

Fase 9 necesita actividad, resultado fiscal y sector externo con la misma
disciplina que el BCRA: revisiones por punto, bases y estacionalidad explícitas
y ratios que se niegan cuando los insumos no son compatibles.

Hay dos caminos oficiales:

- la [API de Series de Tiempo](https://www.argentina.gob.ar/datos-abiertos/api-series-de-tiempo),
  un **distribuidor** de indicadores de distintos organismos, sin clave, con
  licencia por dataset;
- el [Catálogo API-INDEC](https://api.indec.gob.ar/), lanzado el 2026-11-02 en
  beta: la fuente primaria de lo que publica el INDEC, con cuenta gratuita y
  token JWT de 12 meses, interfaz PostgREST de hasta 1.000 filas por respuesta y
  19 servicios (EMAE, IPC, salarios, canastas, IPI, comercio exterior por rubro y
  país, EPH, población). No ofrece PIB, balanza de pagos ni datos fiscales.

Ninguno de los dos publica fechas de publicación o revisión por fila.

## Medición (2026-11-03)

Contra el cable real, antes de fijar el set:

- **El distribuidor va atrás de la fuente.** Series de Tiempo tenía el EMAE
  hasta julio de 2026 y el comercio exterior hasta agosto; el INDEC, hasta
  agosto y septiembre. El EMAE de julio además **difiere**: original 151,512 en
  el INDEC contra 151,554 en el distribuidor, desestacionalizado 149,792 contra
  149,648. El distribuidor muestra una revisión vieja.
- **El EMAE del INDEC es coherente consigo mismo.** La variación mensual
  desestacionalizada calculada desde el índice coincide con la publicada con un
  desvío máximo de 2,5e-14 puntos en 271 meses; la interanual, 2,7e-14 en 260.
  `observaciones` vino vacío en toda la historia y `valor_null` sólo trae `///`
  en las variaciones de 2004, que no tienen mes previo. Los 16 sectores traen
  índice original desde 2004, sin nulos.
- **El comercio exterior del INDEC no da totales.** Viene por rubro, subrubro y
  país. En agosto de 2026 la suma de las 1.820 filas de exportación fue
  8.865,9 M USD con 959 celdas suprimidas (`s`) y un rubro «confidencial» de
  814 M; las 1.019 de importación sumaron 6.706,6 M sin supresiones, 0,16 %
  sobre el total del distribuidor, que es otra vintage. Sumar celdas no
  reproduce un total publicado.
- **El fiscal existe y concilia.** El IMIG mensual de la Secretaría de Hacienda
  (resultado primario e intereses netos) llega a agosto de 2026 y el PIB anual a
  precios corrientes, base 2004, a 2025; los tres son CC BY 4.0. El primario
  sobre PIB da −2,66 % en 2023, 1,78 % en 2024 y 1,38 % en 2025. El resultado
  financiero mensual del IMIG viene **vacío** (`count: 0`) aunque su metadata
  dice que llega a agosto de 2026.

## Decisión

1. **Cada serie tiene una fuente declarada y nunca la cambia en silencio.** El
   set de [`declared-argentina-indicators.ts`](../../../src/modules/macro-series/domain/declared-argentina-indicators.ts)
   tiene 25 series:
   - del **INDEC** (`indec-api`): EMAE original, desestacionalizado y
     tendencia-ciclo, y el índice original de los 16 sectores;
   - de **Series de Tiempo** (`argentina-series-tiempo`): exportaciones,
     importaciones y saldo publicado del ICA; resultado primario e intereses
     netos del IMIG; PIB anual a precios corrientes.

   El orquestador elige el adaptador por `sourceId`. Pasar una serie de una
   fuente a otra es declarar otra serie.

2. **Una definición dice qué serie es.** `argentina-indicator-1.0.0` lleva
   frecuencia, unidad tal como la imprime la fuente, **escala** (`million`),
   moneda, ajuste estacional, base de precios e índice, segmento metodológico,
   metodología y los **filtros** que la separan dentro de un servicio
   multi-serie. Se guarda versionada en `argentina_indicator_definitions`; un
   cambio de definición es una revisión nueva.
3. **El token no viaja por el código.** La allowlist de `indec-api` nombra
   `INDEC_API_TOKEN` y la puerta lo agrega después de autorizar el destino
   (patrón de la ADR 0033), sólo hacia los dos servicios del EMAE. El catálogo,
   el login y el OpenAPI del portal no se alcanzan. El largo máximo de una
   credencial pasa de 512 a 4.096 caracteres para admitir un JWT.
4. **El lector del INDEC es cerrado por servicio** (`indec-api-1.0.0`): conjunto
   exacto de columnas, cada fila igual a los filtros declarados, `periodo`
   coherente con `anio` y `mes`, un período por fila, número leído desde su
   texto (nunca por `double`), un valor nulo sólo con signo convencional y una
   nota sólo si es uno de esos signos. Pagina por `offset` con orden por la
   clave completa, como pide el catálogo. Una serie declarada que devuelve cero
   filas es `no_rows` —un sector renombrado—, no «nada que registrar». Un `401`
   o `403` es `unauthorized` y nombra el token.
5. **Los signos del INDEC viajan con el punto.** `source_note` guarda `*`,
   `**`, `e`, `i`, `u`, `-`, `.`, `...`, `///` o `s`. Un punto cuyo signo cambia
   —un provisorio que deja de serlo— es una revisión aunque el valor no cambie.
6. **Revisión por punto, disponibilidad observada.** Cada corrida lee la
   historia entera y la compara con lo vigente
   (`argentina-indicator-full-history-1.0.0`): un punto nuevo, uno revisado o
   uno que la fuente deja de traer —retirado, nulo con motivo, nunca cero—
   publica una revisión con `available_at` igual a la observación. Más de un
   décimo de cambios sobre veinte o más puntos comparados deja la corrida
   `quarantined` hasta que el owner la acepte (`--accept-mass-change`).
7. **Lecturas puras, en lectura.** La variación mensual usa sólo la serie
   desestacionalizada **publicada** y meses contiguos del mismo segmento; el
   ratio fiscal suma los doce meses originales del año y divide por el PIB
   nominal de ese año con la misma moneda y **escala** —la fuente escribe
   «Millones de pesos» y «Millones de pesos corrientes», y lo que se compara es
   la magnitud—; el saldo comercial resta exportaciones e importaciones del
   mismo mes y base. Un año incompleto, un cero o una base distinta dan `null`
   con motivo.
8. **Fuera de este slice, con su propio slice:** la composición del comercio
   exterior por rubro, uso y destino desde el INDEC; el resultado financiero
   (derivado por identidad o desde otra fuente), y el resto del catálogo del
   INDEC.

## Evidencia

En una réplica vacía y migrada, contra los cables reales:

- primera vuelta del set: 25 corridas `succeeded`, 6.694 puntos, 25 requests
  (19 al INDEC, 6 al distribuidor); segunda vuelta: 25 `duplicate`;
- almacenamiento: ~2 MB, ~305 bytes por fila con índices;
- conciliación con lo publicado: variación mensual desestacionalizada de
  agosto de 2026 calculada 0,065985099444594 % contra 0,06598509944459874 % del
  INDEC; saldo comercial calculado contra el publicado con desvío máximo de
  1,4e-12 M USD en 416 meses; primario sobre PIB de 2026 `null` con
  `incompatible_period` porque el año no terminó.

## Consecuencias

- La página Argentina (`F9-06`) lee estas series con su fuente, su fecha y su
  metodología por serie.
- El token se renueva a mano una vez por año; el runbook lo describe y la
  corrida falla por nombre antes de tocar lo guardado.
- El INDEC no publica su cuota: el tope diario es del proyecto (60) y se revisa
  con el primer `429`.
- El catálogo está en beta. Un cambio de columnas, de filtros o de signos
  detiene la serie por nombre en lugar de desplazar valores.
