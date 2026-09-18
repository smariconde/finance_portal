# ADR 0021: qué conjunto recorre el refresh

- Estado: aceptado
- Fecha: 2026-09-18
- Alcance: define el **conjunto seguido** del incremento 4 de `F2-05`: qué filers
  vuelve a mirar el refresh. Reemplaza la definición del punto 3 de la
  [ADR 0016](0016-analysis-scope-sector-matrices.md). No decide el mecanismo del
  refresh ni su marca de agua, no autoriza cron, gasto ni proveedores nuevos.
- Decisiones relacionadas: [ADR 0016](0016-analysis-scope-sector-matrices.md)
  (alcance analítico), [ADR 0015](0015-durable-ingestion-jobs.md) (jobs
  durables), [ADR 0011](0011-issuer-succession-reporting-lineage.md) (linaje de
  reporte), [ADR 0017](0017-sec-history-window.md) (ventana de historia),
  [ADR 0019](0019-observation-history-prune.md) (poda),
  [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota diaria)

## Contexto

El incremento 4 de `F2-05` es el refresh: `submissions` dice qué filers
presentaron algo nuevo y **sólo esos** vuelven a bajar companyfacts. Antes de
escribir una línea hay que contestar a quiénes mira, y la respuesta que estaba
escrita no se puede ejecutar hoy.

La ADR 0016 lo dejó así: «el refresh de CIK cambiados recorre sólo el conjunto
seguido: las empresas valuadas y los sectores con matriz». Las dos cosas son de
fases posteriores —las empresas valuadas aparecen con la corrida por ticker
(Fase 6) y los sectores con matriz, con las matrices (Fases 7 y 8)—. Hoy no existe
ninguna de las dos. Con esa definición el incremento 4 espera dos fases, o se
inventa mientras tanto una lista declarada que nadie mantiene y que se desincroniza
en la primera ingesta.

El universo tampoco sirve. La ADR 0016 sacó del alcance el backfill de los 503
miembros, y un refresh que los recorriera lo volvería a meter por la puerta de
atrás: 501 requests por vuelta sólo para preguntar, sobre 495 filers de los que no
se guardó un solo hecho.

## Decisión

**El conjunto seguido son los filers que ya tienen fundamentals publicados.**

Un filer está en el conjunto cuando existe al menos una observación publicada por
una corrida de `sec.companyfacts` cuyo sujeto es su entidad legal, y esa entidad
tiene un CIK vigente en el grafo de identidad. La regla viaja versionada dentro del
plan del refresh (`companyfacts-refresh-plan-1.0.0`), igual que el plan del
backfill lleva el suyo.

Lo que esa definición fija:

1. **Se define sola.** Es una consulta sobre lo que ya está en la base personal,
   no una lista que alguien mantiene ni un registro que hay que dar de alta. No
   existe el estado «seguido pero sin datos» ni «con datos pero sin seguir».
2. **Es lo que el refresh significa.** Mantener fresco lo que ya bajaste. Un filer
   del que no se guardó nada no tiene nada que refrescar: bajarlo por primera vez
   es una ingesta, y la ingesta tiene su propio comando y su propio gate.
3. **Crece por donde corresponde.** Cada `fundamentals:ingest --ticker --apply`
   suma su filer, y cuando `F6-05` haga la ingesta bajo demanda, cada ticker que
   el owner pida entra al conjunto el mismo día, sin tocar código ni configuración.
   La definición no cambia cuando aparezcan las valuaciones ni las matrices: esas
   fases agregan filers al conjunto, no una regla nueva.
4. **Encoge igual de solo.** Un sujeto cuyas observaciones se podan enteras
   (ADR 0019) sale del conjunto, que es lo correcto: no queda nada que mantener
   fresco.
5. **Incluye a los antecesores de reporte, y está bien.** La historia de un sucesor
   vive en el CIK anterior (ADR 0011) y la ingesta la baja, así que el antecesor
   entra por la misma regla. No presenta más, y por eso su sondeo cuesta un request
   y termina en «sin novedades»: es el precio de no tratar a un CIK muerto como un
   caso especial.
6. **Se pregunta sin red.** El plan del refresh es una consulta a PostgreSQL:
   enumerar el conjunto no gasta cuota de la fuente. La red aparece recién al
   correr el job.

## Lo que el conjunto es hoy

Medido sobre la base personal el 2026-09-18, contando observaciones de corridas de
`sec.companyfacts`:

| CIK          | Entidad legal            | Observaciones | Última aceptación registrada |
| ------------ | ------------------------ | ------------: | ---------------------------- |
| `0000034088` | EXXON MOBIL CORP         |           822 | 2026-05-04T16:40:35Z         |
| `0000320193` | Apple Inc.               |         1.151 | 2026-07-31T10:01:02Z         |
| `0001045810` | NVIDIA CORP              |         1.194 | 2026-08-26T20:36:00Z         |
| `0001326160` | Duke Energy CORP         |           901 | 2026-05-05T15:59:24Z         |
| `0001652044` | Alphabet Inc.            |           950 | 2026-07-23T01:15:54Z         |
| `0002115436` | ExxonMobil Holdings Corp |            89 | 2026-08-03T18:55:38Z         |

Seis filers: cinco miembros vigentes del índice y el antecesor de reporte de
ExxonMobil, que dejó de presentar el 2026-07-01 y cuya historia sigue siendo la del
sucesor. Una vuelta completa del refresh son **seis requests** cuando ninguno
presentó nada nuevo, contra los 501 que costaría preguntarle al universo.

## Consecuencias

- El incremento 4 se puede escribir y probar ahora, sin esperar a la Fase 6 ni a
  las matrices, y sin una tabla de suscripciones que después habría que migrar.
- El costo del refresh es proporcional a lo que el owner efectivamente usa. Con la
  cuota diaria de la ADR 0020 (2.000 requests para `sec-edgar`), una vuelta de
  sondeo del conjunto de hoy gasta el 0,3 %.
- La ADR 0016 queda corregida en su punto 3: «las empresas valuadas y los sectores
  con matriz» describe de dónde van a venir los filers, no cómo se los enumera.
- El conjunto seguido es también la respuesta a «qué sabe el portal», así que la
  misma consulta sirve después para la frescura de una superficie. Nada de eso se
  construye en este incremento.
- Un filer entra al conjunto por tener datos, no por tener interés: si el owner
  ingiere un ticker para mirarlo una vez, el refresh lo va a seguir sondeando. El
  remedio es una poda, que ya existe, y no una lista de exclusiones.

## Alternativas descartadas

- **Esperar a la Fase 6 y a las matrices.** Deja el incremento 4 abierto y con él
  el único agujero que queda de `F2-05`. Además invierte la dependencia: el refresh
  es infraestructura de la ingesta, no una consecuencia de las superficies.
- **Una lista declarada por el owner** (un archivo como `declared-successions.ts` o
  una tabla). Es la forma de que la lista y los datos se desincronicen: un ticker
  ingerido y no declarado nunca se refresca, y uno declarado y nunca ingerido gasta
  un request por vuelta para siempre. Declarar tiene sentido cuando la fuente no
  puede probar el hecho (ADR 0014); acá la base ya lo sabe.
- **El universo constituido.** Reintroduce el backfill que la ADR 0016 sacó, con el
  costo por vuelta multiplicado por 83.
- **Los filers con una corrida publicable, en vez de con observaciones.** Es casi
  el mismo conjunto y se consulta más barato, pero incluye al filer cuya corrida
  terminó en `no_company_facts` y al que quedó sin una sola fila después de una
  poda: dos casos en los que no hay nada que refrescar. Lo publicado es la
  definición honesta de «ya lo bajaste».
- **Los filers con símbolo vigente en el índice, intersectados con los que tienen
  datos.** El antecesor de reporte no tiene símbolo y quedaría afuera, que es
  justamente el caso en el que perder una enmienda rompe el linaje.
