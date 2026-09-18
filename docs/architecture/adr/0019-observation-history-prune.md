# ADR 0019: poda de la historia publicada fuera de la ventana

- Estado: aceptado
- Fecha: 2026-09-17
- Alcance: borrar observaciones publicadas que quedaron fuera de la ventana de
  cinco ejercicios, y registrar cada borrado para que la base siga explicando qué
  falta y por qué. No cambia la ventana, no toca documentos ni corporate actions,
  y no habilita borrar nada más.
- Decisiones relacionadas: [ADR 0017](0017-sec-history-window.md) (la ventana y el
  ancla), [ADR 0018](0018-lighter-observation-rows.md) (la fila liviana),
  [ADR 0016](0016-analysis-scope-sector-matrices.md) (pide decidir la poda antes de
  `F6-06`), [ADR 0012](0012-stock-splits-share-basis.md) (evidencia de splits),
  [contrato point-in-time](../../data/point-in-time-contract.md)

## Contexto

La ADR 0017 dejó la poda afuera a propósito: la ventana gobierna las ingestas
nuevas y lo ya publicado no se borra. Eso deja dos deudas que la ADR 0016 nombra:

- **La base personal.** Sus seis filers se ingirieron con `sec-core-concepts-1.0.0`
  y conservaban toda su historia XBRL desde 2006: 14.276 observaciones, 6,5 MB
  después de la migración `0012`.
- **El crecimiento.** La ventana no se achica sola. Cada 10-K nuevo mueve el ancla
  un ejercicio, y las filas del ejercicio que sale quedan. Sin poda la base crece
  un ejercicio por año, y el PostgreSQL hosteado de `F6-06` tiene que entrar en un
  plan gratuito.

Entonces la poda no es un borrado único: es una operación que se repite. Lo que
hay que decidir no es «¿borramos?», es **con qué regla, y qué queda dicho después**.

### El problema real no es borrar, es lo que el borrado calla

La decisión 5 de la ADR 0017 agregó `ingestion_runs.selection_anchor_on` para que
`F3-02` pueda distinguir dos ausencias que se parecen:

- **antes del corte de la corrida:** esa corrida no fue a buscar el período;
- **después del corte:** el filer no lo publicó, o se rechazó con nombre.

Un `DELETE` rompe justamente eso. La corrida de Apple del 2026-09-14 declara la
selección `1.0.0`, que fue a buscar desde 2006; si se borran sus filas anteriores a
2020 sin decir nada, la base afirma que Apple no reportó nada antes de 2020. La
corrida deja de explicar lo que hay, y la ausencia vuelve a ser ambigua —esta vez
sin ninguna forma de resolverla, porque el dato ya no está.

## Decisión

### 1. La poda borra el complemento exacto de la ventana, con la misma aritmética

Regla `sec-history-prune-1.0.0`. Una observación se borra si

```text
as_of < ancla − 5 años − 14 días
```

y los seis conceptos sensibles a splits usan `ancla − 6 años − 14 días`, igual que
la ingesta. El corte es **estricto** al revés del de la ventana —la ingesta
conserva `end >= corte`, la poda borra `as_of < corte`—, así que las dos reglas no
pueden discrepar en el borde.

`as_of` es el fin de período de la fila: la construcción de vintages lo llena con
el `end` del hecho, para duraciones e instantes por igual.

La aritmética no se reimplementa. `secHistoryCutsFrom(anchorOn)` es la única
función que resta los años y los días, y la usan tanto `buildSecHistoryWindow`
como el plan de la poda. Un día de diferencia entre las dos sería un ejercicio
entero de más o de menos.

### 2. El ancla se lee de la corrida; no se recalcula ni se adivina

La poda **no sale a la red** y no mira las filas para deducir el corte. Toma
`selection_anchor_on` de la última corrida de companyfacts del sujeto que registró
una, y usa esa fecha.

Es la única fuente correcta. El ancla exige la duración anual más reciente con foco
`FY` (ADR 0017, decisión 1), y ese foco es un atributo del hecho en companyfacts
que la observación publicada no guarda: deducirlo de `period_type = 'annual'`
tomaría un TTM de un 10-Q, que es exactamente el error que la ADR 0017 midió con
Amazon.

De ahí las dos negativas, con su nombre:

- `anchor_unknown`: el sujeto no tiene ninguna corrida con ancla.
- `selection_superseded`: el ancla es de otra selección, que declara otra ventana
  como componente y por lo tanto describe otro corte.

En los dos casos la salida es la misma y es barata: volver a ingerir el filer. Son
dos o tres requests, publica cero si no hay nada nuevo, y deja el ancla vigente
registrada. Esa secuencia —ingerir, después podar— es el procedimiento, no un
rodeo.

### 3. Cada poda deja una fila que explica lo que ya no está

Migración `0013`: tabla `observation_prunes`, append-only, una fila por sujeto y
por poda, con la regla, la selección, el ancla y **la corrida que la registró**, los
dos cortes, la lista de conceptos de evidencia, cuántas filas se borraron y cuántas
quedaron, los extremos de lo borrado, el actor, el motivo y el instante.

Es la contracara de `selection_anchor_on`, y para un sujeto podado es la respuesta
más reciente y más estricta: **lo que falta antes del corte de la poda es la poda;
lo que falta después es la fuente.**

Cuatro checks sostienen que la fila se pueda leer sin el código que la escribió:

- ninguna fila borrada termina en el corte o después, que es lo que hace legible
  todo lo demás;
- el corte de evidencia nunca es más nuevo que el general;
- el corte nunca es más nuevo que su ancla;
- los extremos están exactamente cuando se borró algo.

La lista de conceptos de evidencia se guarda entera y no sólo por versión de regla:
dentro de cinco años el registro tiene que poder leerse sin ejecutar este código.

El borrado y su registro van en la **misma transacción**. Un borrado sin registro
sería el caso que esta ADR existe para evitar.

### 4. Los documentos no se tocan

Después de la poda de la base personal, 191 de 326 `source_documents` se quedan sin
ninguna observación. Se conservan igual, por tres razones:

- un documento es el evento inmutable de que **esa presentación se leyó**, que
  sigue siendo cierto;
- tres corporate actions registradas apuntan a documentos que quedarían huérfanos
  —el 7:1 de Apple de 2014, la sucesión de ExxonMobil y el traspaso de Kraft
  Heinz— y `corporate_actions.source_document_id` no tiene foreign key que lo
  proteja;
- son 200 kB para 326 documentos; a escala del universo, unos 8 MB para 13.141. El
  problema de tamaño son las observaciones, no los documentos.

La poda borra valores, no el registro de qué se fue a leer.

### 5. Un split confirmado con evidencia que la poda borró queda registrado y se nombra

Los eventos societarios no se tocan. Si la evidencia que confirmó un split queda
fuera de la ventana, `corporate-actions:splits` lo nombra con la regla que ya
existe: el ratio sale `precedes_published_history` (`split-claim-horizon-1.0.0`) y
la corrida marca `recorded_split_not_reconfirmed`. El plan queda `unchanged`.

Medido sobre la base personal después de podar: el 7:1 de Apple de 2014 sigue
registrado y sin reconfirmar; el 4:1 de Apple, el 4:1 y el 10:1 de NVIDIA y el 20:1
de Alphabet se confirman en las mismas presentaciones que antes. Ninguna lectura
`latest_adjusted` cambia: el 7:1 sólo afectaba períodos anteriores a 2014, y la
fila más vieja que queda de Apple es del 2019-09-28.

### 6. La poda no habilita ningún borrado automático

Es un job a mano, en seco por defecto, con `--reason` obligatorio para escribir.
No corre en un gate, no la dispara una ingesta y no hay programación. Repetirla es
inocua: la segunda vez no encuentra nada y registra una fila con cero borradas.

El rollback de la `0013` se niega mientras haya podas registradas. Borrar la
auditoría de un borrado irreversible es peor que el borrado: exportarla y limpiarla
es una decisión explícita (`TM-16`).

## Medición sobre la base personal (2026-09-17)

Backup con `pg_dump -Fc` antes de empezar. Secuencia completa: reingesta, poda en
seco, poda, y las tres verificaciones.

**Reingesta de los seis filers** (14 requests): 0 publicadas, 5.107 duplicadas. Las
seis anclas quedan registradas: Apple 2025-09-27, NVIDIA 2026-01-25, Alphabet, Duke
y el antecesor de ExxonMobil 2025-12-31, y el sucesor 2026-06-30 por
`latest_period`, que es el único sin ejercicio anual.

**Poda**, sin red:

| Filer           |      Ancla |      Corte |      Antes |  Borradas |    Quedan |
| --------------- | ---------: | ---------: | ---------: | --------: | --------: |
| Apple           | 2025-09-27 | 2020-09-13 |      3.254 |     2.103 |     1.151 |
| NVIDIA          | 2026-01-25 | 2021-01-11 |      3.541 |     2.347 |     1.194 |
| Duke            | 2025-12-31 | 2020-12-17 |      3.071 |     2.170 |       901 |
| Exxon antecesor | 2025-12-31 | 2020-12-17 |      2.510 |     1.688 |       822 |
| Alphabet        | 2025-12-31 | 2020-12-17 |      1.811 |       861 |       950 |
| Exxon sucesor   | 2026-06-30 | 2021-06-16 |         89 |         0 |        89 |
| **Total**       |            |            | **14.276** | **9.169** | **5.107** |

**Verificaciones:**

- **Las filas que quedan son las que una ingesta nueva produciría.** Los 5.107 son
  exactamente las vintages que la reingesta anterior había contado filer por filer,
  y una tercera ingesta con `--apply` publica 0 y duplica 5.107 con 14 requests.
  Esta es la prueba de que el corte de la poda y el de la ventana son el mismo.
- **Integridad:** 0 cadenas de revisión rotas y 0 revisiones vigentes duplicadas.
  Ningún grupo de revisión cruza el corte, y no puede cruzarlo: un grupo es un
  hecho `(concepto, unidad, inicio, fin)`, así que todas sus revisiones comparten
  `as_of` y caen del mismo lado.
- **Splits:** `unchanged` para Apple, NVIDIA y Alphabet, con el 7:1 de 2014 y los
  2:1 de Alphabet de 2016 nombrados `precedes_published_history`.
- **Tamaño:** las observaciones pasan de 6,5 MB a 2,4 MB compactadas (481 bytes por
  fila, contra los 491 que midió la ADR 0018) y la base, de 18 MB a 14 MB.

## Consecuencias

- La base personal contiene exactamente la ventana de sus seis filers, y cualquier
  período anterior está explicado por su fila de `observation_prunes`.
- La poda se vuelve a correr cuando el ancla avanza. Es barata: dos o tres requests
  por filer para refrescar el ancla, y ninguno para borrar.
- Una lectura point-in-time sobre un sujeto podado no puede concluir «la fuente no
  lo reportó» para un período anterior al corte de la poda. `F3-02` tiene la fila
  para decirlo; el contrato point-in-time lo deja escrito.
- El presupuesto de `F6-06` se estima ahora con la ventana podada y no con la
  historia acumulada.
- El rollback de la `0013` es explícito y se niega solo.

## Alternativas descartadas

- **Un `DELETE` a mano, documentado en el backlog.** Deja la corrida mintiendo
  sobre lo que hay y no se puede repetir el año que viene sin volver a escribirlo.
  Es la razón de ser de esta ADR.
- **Recalcular el ancla desde las filas guardadas.** El foco `FY` no está en la
  observación, y sin él un TTM de un 10-Q se toma por un ejercicio (medido con
  Amazon en la ADR 0017).
- **Bajar companyfacts para recalcular el ancla dentro de la poda.** Ata un borrado
  a la disponibilidad de la fuente y duplica lo que la ingesta ya hace y ya
  registra. La secuencia «ingerir, después podar» cuesta lo mismo y deja más dicho.
- **Borrar también los documentos huérfanos.** Rompe la procedencia de tres
  corporate actions registradas para ahorrar 200 kB.
- **Guardar sólo el corte, sin conteos ni extremos.** Sin `deleted_max_as_of` no se
  puede verificar que la poda no se comió nada de la ventana, que es el único check
  que hace confiable al registro.
- **Marcar las filas como borradas en vez de borrarlas.** No ahorra espacio, que es
  el problema que la ADR 0016 plantea.
