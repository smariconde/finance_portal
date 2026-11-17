# ADR 0079: `/argentina` marca lo que llegó desde la visita anterior

- Estado: aceptada
- Fecha: 2026-11-17
- Alcance: `F9-20`, después de `F9-12` y `F9-18`.
- Relacionadas: [ADR 0005](0005-request-time-runtime-boundary.md) (el modo se
  resuelve en el request), [ADR 0070](0070-argentina-refresh-on-open.md) (las
  series se actualizan al abrir), [ADR 0065](0065-bcra-monetary-catalog-vintages.md)
  y [ADR 0069](0069-argentina-activity-fiscal-external.md) (disponibilidad =
  observación).

## Contexto

El owner pidió que `/argentina` avise cuando hay un dato nuevo: «no sé si por
alguna notificación o que se remarque alguna de las cards». Hay tres hechos que
deciden la forma:

1. **Nada llega mientras el owner no mira.** No hay refresco programado: un dato
   entra cuando una visita dispara la actualización de la ADR 0070. Una
   notificación push o un mail no tendrían qué avisar sin un cron, que sería una
   capacidad nueva con su propio modelo de amenazas (`TM-10`, `TM-11`).
2. **Lo diario cambia siempre.** El dólar, la brecha, las reservas, el ITCRM y
   la soja tienen un dato nuevo cada día hábil y ya muestran su fecha. Lo que
   vale avisar es una publicación por período: el EMAE, el IPC, el resultado
   fiscal, el comercio de bienes y la ronda del REM. En los siete días previos a
   esta ADR llegaron, en Production, el IPC de octubre, el fiscal y el comercio
   de septiembre y la ronda de octubre del REM.
3. **La disponibilidad pública no sirve para esto.** El REM se fecha con su
   publicación (2026-11-06) y entró a la base el 2026-11-17: leído por
   `public_availability`, una visita del 10 de noviembre ya lo «tenía».

## Decisión 1 — nuevo es lo que esta instalación registró después de la visita anterior (`argentina-news-1.0.0`)

Cada métrica se lee dos veces con `knowledgeBasis = system_recorded`: al corte
del tablero y al instante de la visita anterior. Se compara el último período
con valor:

- un período posterior, o uno donde antes no había ninguno: **Nuevo**;
- el mismo período con otra cifra, comparada como decimal: **Revisado**;
- otra cosa, incluido un último período que retrocedió: nada.

Las métricas son cinco: EMAE desestacionalizado, IPC mensual (variable 27 del
BCRA), ronda del REM, resultado primario mensual y comercio de bienes (el mes en
que exportaciones e importaciones están las dos). La lectura no agrega columnas:
los vintages ya guardan `recorded_at`. Una consulta de indicadores sirve a los
dos cortes; el IPC y el REM se leen dos veces. Si falla, la página no marca nada
y sigue.

## Decisión 2 — la visita es una sesión y vive en la base (`surface-visit-1.0.0`)

Decisión del owner: la última visita se guarda en la base de análisis, no en el
navegador, para que el teléfono y la computadora vean lo mismo. Tabla
`surface_visits` (migración `0053`), una fila por superficie que se sobrescribe:
es una ayuda de lectura, no evidencia, y no se versiona. La superficie es un
conjunto cerrado (`argentina`), con un check en la base.

Una visita es una **sesión**: vistas a menos de 30 minutos de la anterior le
pertenecen. La base de la sesión es la última vista de la sesión anterior y no
se mueve mientras la sesión dura, así que recargar o releer la página cuando
termina una actualización conserva las marcas, y lo que llegó durante la sesión
también se marca. La primera sesión no tiene base y no marca nada.

El render sólo **lee** la fila (ADR 0005: la página no escribe al renderizar).
`VisitRecorder`, en el cliente, llama a `recordArgentinaVisit` después de
mostrarse y otra vez cuando la página se relee con un corte nuevo; un prefetch no
lo ejecuta. El repositorio aplica la regla bajo `FOR UPDATE`, así dos pestañas
no pierden una vista.

## Decisión 3 — cómo se ve

- En las tarjetas de lectura rápida (actividad, inflación, primario y comercio),
  una marca «Nuevo» o «Revisado» junto a la fecha; «Nuevo» además pinta el
  anillo de la tarjeta.
- En el índice de bloques, un punto con su texto para lectores de pantalla.
- Una línea antes de las tarjetas: «Desde tu visita del dd/mm hh:mm», con cada
  métrica marcada como vínculo a su bloque. Sin novedades, la línea no existe.

«Nuevo» usa el azul de información del sistema, nunca el bermellón, que es de
acción, y siempre va con su palabra. Sin punto en la sidebar (decisión del
owner): el dato llega casi siempre en la visita misma.

## Seguridad (`TM-03`, `TM-04`, `TM-07`)

`recordArgentinaVisit` resuelve el modo en el request y en un runtime trabado no
abre la base. No acepta entrada: la superficie y el instante son del servidor, y
cualquier argumento se rechaza. Escribe una fila y contesta un booleano; un
error sólo deja su tipo en el log. Una llamada directa, como mucho, oculta una
marca de «Nuevo»: no lee ni expone datos.

## Consecuencias

- Una notificación fuera de la página sigue fuera de alcance mientras no haya un
  refresco programado; si llega, puede leer esta misma regla.
- Otra superficie que quiera marcar novedades agrega su código al conjunto
  cerrado y al check, con una migración.
- Rollback: `drizzle/rollback/0053_surface_visits.down.sql` borra la tabla; se
  pierde sólo la marca de la próxima sesión.
