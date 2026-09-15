# ADR 0013: traspasos, delistings y renombres con evidencia fechada

- Estado: aceptado
- Fecha: 2026-09-15
- Alcance: incremento 3a de `F2-04`; fija qué evidencia de la SEC fecha un cambio de
  mercado, una salida del mercado y un renombre, cómo se escriben sobre el grafo sin
  reescribir historia, y qué se rechaza con nombre porque la SEC no lo fecha
- Decisiones relacionadas: [ADR 0010](0010-sec-xbrl-ingestion.md) (disponibilidad por
  aceptación, identidad conocida desde la descarga),
  [ADR 0011](0011-issuer-succession-reporting-lineage.md) (eventos y vínculos),
  [modelo de identidad](../../data/identity-model.md),
  [contrato point-in-time](../../data/point-in-time-contract.md)

## Contexto

Al cerrar el incremento 2, replanificar el universo con el mismo pin de la lista
dejaba dos rechazos sobre datos reales: el renombre de `BEN` como
`stale_effective_date` y el traspaso de `KHC` de Nasdaq a NYSE como
`unresolved_share_class`. La tabla de tickers de la SEC dice cómo está cada CIK
**hoy** y no tiene fechas, así que el planner del universo no podía decidir ni cuándo
pasó ni qué pasó.

Leyendo el planner apareció además un defecto: un constituyente rechazado en la etapa
de plan dejaba su security fuera de los miembros y, con un pin nuevo, **se cerraba su
membresía como salida del índice**. Kraft Heinz habría salido del S&P 500 por un
traspaso de mercado.

El cable se midió el 2026-09-15 antes de escribir la regla, sin conservar payload: 13
requests a la SEC —la tabla y `submissions` de doce filers— y, para encontrar casos
reales, el historial del paquete de constituyentes desde enero de 2025: 2 requests a
la API de GitHub y los 39 commits del CSV, comparados de a pares.

- **La tabla del grafo diverge en dos CIK**, y el pin no tiene commits posteriores.
- **Traspaso de mercado** (Kraft Heinz, Nasdaq→NYSE; Fiserv, NYSE→Nasdaq con FI→FISV):
  8-K con ítem 3.01 dos semanas antes; después el emisor presenta el `8-A12B` que
  registra la clase en el mercado nuevo y el `25` que la retira del viejo con segundos
  o minutos de diferencia; el mercado nuevo presenta el `CERT`. Kraft Heinz y Fiserv
  presentaron también un `8-A12B` con su `CERT` **sin** `25`: eran emisiones de deuda.
- **Delisting por adquisición** (Hologic, Electronic Arts, AvalonBay): el mercado
  presenta el `25-NSE` y el emisor un 8-K con 2.01, 3.01 y 5.01 el mismo día, en
  cualquier orden —AvalonBay: `25-NSE` a las 14:53, 8-K a las 20:01—. Kraft Heinz tuvo
  un `25-NSE` en 2025 sin ningún 3.01 y sus acciones siguieron cotizando: retiraba
  deuda.
- **Quién presentó** está en el accession: sus primeros diez dígitos son el CIK del
  que presenta. `0001354457` es «Nasdaq Stock Market LLC» y `0000876661` «NEW YORK
  STOCK EXCHANGE LLC» según la propia SEC.
- **`submissions` publica `items`** como columna paralela y `formerNames` con el borde
  en que EDGAR dejó de usar cada nombre: `FRANKLIN RESOURCES INC` hasta
  2026-08-14T04:00Z, `EQUITY RESIDENTIAL` hasta 2026-08-12T04:00Z.
- **La tabla sí deja de mostrar a quien sale**: Hologic, Electronic Arts y AvalonBay ya
  no están, aunque `submissions.tickers` de las dos últimas todavía los publique. No
  dice desde cuándo.
- **Un cambio de ticker en el mismo mercado no deja nada fechado.** BK→BNY, MMC→MRSH y
  SATS→ECHO no tienen `8-A12B`, `CERT` ni `25`; `submissions.tickers` sólo publica el
  vigente; los 8-K con 5.03 o 8.01 que los rodean también se usan para estatutos y
  anuncios.
- **Una adquisición entre dos miembros** (AvalonBay por Vivmark, ex Equity
  Residential) comparte accessions de `425` y `S-4` en los índices de los dos. En los
  otros dos casos el adquirente es privado y no está en el grafo.

## Decisión

### Divergencia es pregunta; la evidencia fechada la responde

`listing-divergence-1.0.0` compara el grafo abierto con la tabla vigente, por CIK y sin
red más allá de la tabla:

- `listing_moved`: el mismo símbolo en otro mercado, o uno de cada lado con mercado y
  símbolo distintos (la forma de Fiserv);
- `symbol_changed`: mismo mercado, un símbolo de cada lado;
- `listing_unassigned`: el listing registrado ya no figura y nada lo reemplaza;
- `name_changed`: la tabla trae un único nombre y es otro.

Ninguna divergencia escribe nada. Se paga un request de `submissions` por CIK que
diverge, o que el owner pide verificar con `--cik` (`check_requested`), con un techo de
64 filers por corrida.

### `sec-listing-evidence-1.0.0`

Toda pieza tiene que estar aceptada **después** de la versión registrada; si el índice
reciente no la alcanza y hay archivos históricos, se rechaza como
`evidence_window_not_covered` en vez de recorrerlos. El mercado que actuó sale de
`sec-exchange-filers-1.0.0` (CIK de presentador → MIC); un mercado fuera del mapa no
se ubica por descarte.

- **Traspaso**: `25` del emisor, `8-A12B` y `CERT` presentado por el mercado de
  destino, las tres dentro de diez días entre sí. El 3.01 previo se busca hasta noventa
  días antes y su ausencia sólo marca. Faltante nombrado: `transfer_withdrawal_not_found`,
  `transfer_registration_not_found`, `transfer_certification_not_found`.
- **Delisting**: `25-NSE` presentado por el mercado del listing y 8-K con 3.01 a menos
  de tres días. Sin aviso, `delisting_notice_not_found`: retiró otra clase. Con 2.01 y
  5.01 el motivo es `change_in_control_completed`; si no, `not_stated`. Un ítem
  ilegible no cuenta como 3.01.
- **Más de un listing del emisor en el mismo mercado** es `ambiguous_listing`: Alphabet,
  Fox y News Corp tienen dos clases en Nasdaq y ni el `25` ni el `25-NSE` dicen cuál.
- **Renombre**: el nombre vigente de `submissions` coincide con el de la tabla y
  `formerNames` registra el nombre del grafo. `current_name_not_confirmed` y
  `former_name_not_found` si no.
- **Cambio de ticker en el mismo mercado**: siempre
  `symbol_change_without_dated_evidence`. No se toma la fecha de la corrida.

### Un instante: el de la evidencia completa

Un traspaso y un delisting se escriben en **un solo instante** —la aceptación más
tardía de las piezas que los confirman—, que es a la vez el cierre del intervalo viejo,
la apertura del nuevo y el `available_at`: el `CERT` de Kraft Heinz
(2026-09-09T12:44:23Z) y el 8-K de AvalonBay (20:01:44Z). Cerrar antes le haría decir
al grafo algo que la regla todavía no podía confirmar; cerrar en la vigencia legal del
`25` —diez días después de presentado— exigiría una fecha que el cable no publica.

### Qué se escribe

`listing-reconciliation-1.0.0`:

- **Traspaso**: se cierran el listing y su ticker; se abren un listing **con otro ID**
  sobre la **misma** security, en el MIC nuevo, y su ticker, con la accession del `CERT`
  como documento. Hereda `primary_listing`. La membresía cuelga de la security y no se
  toca. Evento `listing_transfer` sobre la security con los dos MIC, los dos símbolos y
  las tres accessions.
- **Delisting**: se cierran el listing y su ticker. La security sigue vigente y su
  membresía la cierra la lista cuando lo diga, no este job. Evento `delisting` sobre el
  listing con el MIC, el símbolo, la accession del aviso y el motivo.
- **Renombre posterior** a la versión registrada: se cierra en el borde de
  `formerNames` y se abre la nueva, como el renombre del planner del universo.
- **Renombre anterior** a la versión registrada —la de `BEN` nació el 2026-09-05 con
  un nombre que EDGAR había dejado de usar el 14 de agosto—: la versión registrada se
  **supersede** en el instante de la descarga y la nueva vale desde el borde. Cerrarla
  en el pasado fingiría que el grafo lo sabía al registrarla; supersederla deja que un
  `as_known` anterior a la corrección siga viendo el nombre viejo.
- Un nombre no tiene aceptación propia: su `available_at` es la descarga del índice, y
  su documento, `submissions/CIK…json`. No hay evento de renombre.

Cierres y supersesiones exigen que la versión siga abierta; si no, la transacción
entera se deshace con `StaleListingPlanError`. `corporate_actions_listing_terms_check`
espeja el dominio: el traspaso es de una security con dos MIC distintos y el delisting
de un listing con su MIC.

### Un rechazo no es una salida del índice

`universe-constitution-1.1.0` retiene las securities de un emisor cuyo constituyente se
rechazó en la etapa de plan: su membresía sigue abierta y el plan cuenta `held`.

## Consecuencias

- Módulos: `parse-sec-listing-index`, `detect-listing-divergences`,
  `verify-listing-evidence` y `plan-listing-reconciliation` en
  `src/modules/corporate-actions/domain/`; puerto, adaptador vivo y orquestador
  `reconcile-listings` en `application/`; `applyListingPlan` en los dos repositorios.
- El parser del índice tiene versión propia (`sec-listing-index-1.0.0`) y valida el
  envelope con `sec-submissions-1.0.0`, que no cambia: es parte de la identidad de las
  observaciones de companyfacts.
- Comando `pnpm corporate-actions:listings`, dry run por defecto, con `--cik` para
  pedir la verificación de un filer. Una corrida por filer, dataset `sec.submissions`.
- Migración `0008` con rollback pareado que reconstruye el tipo y falla a propósito si
  queda algún evento de listing.
- Sobre datos reales: Kraft Heinz pasa de `XNAS` a `XNYS` en el `CERT`, Franklin
  Templeton recupera su nombre desde el 14 de agosto, y replanificar el universo con el
  mismo pin pasa de dos rechazos a cero sin abrir ni cerrar nada. En una base
  descartable constituida con el pin del 2026-07-22, Electronic Arts y AvalonBay se
  deslistan con su `25-NSE` real y el pin del 2026-09-05 cierra después sus dos
  membresías.

## Alternativas descartadas

- **Fechar con la tabla.** No tiene historia; la fecha de la corrida sería inventada.
- **Cerrar el listing en la vigencia legal del `25`.** Diez días después de presentado,
  según la regla; el cable no publica cuándo terminó la negociación, y el traspaso de
  Kraft Heinz ya tenía el mercado nuevo certificado al día siguiente.
- **Leer el `25` o el `25-NSE` completos para saber qué clase retiran.** Exige abrir
  `www.sec.gov/Archives/` en la allowlist para leer un documento por evento; el aviso
  3.01 contemporáneo separa los casos medidos sin salir del índice.
- **Declarar cada cambio de ticker a mano ya.** Una declaración sin evidencia
  estructurada es sólo la palabra del owner; merece su propia regla y queda para el
  incremento 3b junto a los vínculos de adquisición.
- **Reusar el `listing_id` en el mercado nuevo.** El listing es la relación con un
  venue; cambiar su MIC en una versión nueva haría que la misma identidad signifique
  dos mercados.
- **Tratar un traspaso como delisting más constitución nueva.** Perdería que es el
  mismo instrumento y abriría una security que el índice no pidió.

## Límites conocidos

- **Cambios de ticker sin evidencia** quedan rechazados: BNY, MRSH y ECHO no llegarán
  por esta regla. La lista de constituyentes seguirá rechazándolos como
  `unresolved_share_class` hasta una confirmación declarada.
- **Adquisiciones sin vínculo.** El delisting nombra `change_in_control_completed`
  pero no registra quién adquirió; el vínculo entre dos miembros del grafo es el
  incremento 3b.
- **Sólo Nasdaq y NYSE** tienen CIK de presentador en el mapa. Un emisor de NYSE
  American, Arca o Cboe se rechaza como `venue_without_exchange_filer`.
- **La security de un emisor adquirido sigue vigente.** Su estado —cancelada,
  convertida— lo decide la evidencia de la fusión, no el delisting.
- **Corregir un listing** —evidencia anterior a la versión registrada— se rechaza:
  ningún caso real lo pidió y la supersesión de listings tiene sus propias trampas de
  clave.
- **Un renombre posterior cerrado en el lugar** deja que un `as_known` anterior a la
  descarga vea el intervalo viejo cerrado sin ver todavía el nuevo, el mismo límite
  que el renombre del planner del universo. La clave `(id, valid_from)` no admite
  re-emitir el intervalo viejo junto al superseded.
