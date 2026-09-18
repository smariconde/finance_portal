# ADR 0023: derechos y exposición de los extractos congelados de la SEC

- Estado: aceptado
- Fecha: 2026-09-18
- Alcance: resuelve el incremento 1 de `F2-06`. Decide si el repositorio público
  puede contener extractos reales de la SEC congelados como oráculo de regresión,
  qué derechos de `sec-edgar` pasan de `unknown` a una respuesta, y qué sigue
  prohibido. No decide cómo se capturan ni cómo se reducen —eso es el incremento
  2—, no autoriza demo pública, ni resuelve los derechos de ninguna otra fuente.
- Decisiones relacionadas: [ADR 0004](0004-personal-first-runtime.md) (runtime
  personal, sin demo pública), [ADR 0009](0009-egress-boundary.md) (la única
  puerta de salida), [ADR 0010](0010-sec-xbrl-ingestion.md) (semántica de la
  ingesta), [ADR 0017](0017-sec-history-window.md) (ventana de historia),
  [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota diaria)

## Contexto

El oráculo de regresión de los tres parsers de la SEC es hoy
[`fixture-sec-filer.ts`](../../../src/modules/fundamentals/infrastructure/fixture-sec-filer.ts),
un filer sintético. Su encabezado dice por qué: «ningún valor, fecha ni accession
proviene de una descarga: el repositorio es público y los extractos reales
congelados son `F2-06`, con su propia revisión de derechos». Esta es esa revisión.

El fixture sintético prueba que el parser hace lo que creemos que hace. No prueba
que el cable sea como creemos que es. Esa segunda mitad es la que cubre `TM-05`
—parser roto, fuente comprometida o respuesta parcial que publica datos falsos— y
hoy no está cubierta por ningún test: un campo nuevo, una unidad no vista o una
taxonomía que se mueve no rompe nada.

Dos reglas del repositorio bloquean el paso, y ninguna de las dos es un problema
de licencia:

1. `AGENTS.md` y `CLAUDE.md` prohíben commitear payloads capturados en este
   repositorio público.
2. El [registro de fuentes](../../data/source-registry.md) exige que «si una
   licencia no permite conservar raw, tampoco se usa ese raw como fixture», y
   `sec-edgar` declara `rawStorage`, `publicDisplay` y `export` como `unknown`.

El `unknown` es deliberado y está comentado en el código: hasta hoy el payload
descargado no se conservaba, así que la pregunta nunca se hizo. Congelar un
extracto la hace.

### Lo que la SEC publica

Consultado el 2026-09-18:

- [Privacy and Security Information](https://www.sec.gov/about/privacy-information):
  «Information presented on sec.gov is considered public information and may be
  copied or further distributed by users of the web site without the SEC's
  permission», con dos condiciones explícitas: «Please consider appropriate
  citation to the SEC as the source» y «Please do not use the SEC seal or any of
  the other logos or artwork from this site». Los nombres `SEC` y `EDGAR` son
  marcas registradas: se puede referir a ellas en texto, no usarlas de modo que
  sugieran afiliación.
- [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data):
  el acceso es gratuito, con User-Agent declarado y bajo Fair Access —«download
  only what you need and please moderate requests»—. La condición que impone es
  sobre el **ritmo de la descarga**, no sobre qué se hace después con lo
  descargado.

No hay entonces una licencia que impida conservar ni redistribuir el contenido.
Lo que había era una pregunta sin contestar —y, en rigor, contestada a medias: la
[matriz de uso](../../data/provider-use-matrix.md) ya decía de `sec-edgar`
«Confirmado: acceso público, API sin key, copia y redistribución con cita». Esa
conclusión nunca bajó a la fila del registro, que es la que el gate lee. Esta ADR
cierra esa distancia, que es exactamente el tipo de omisión que el registro existe
para volver visible.

## Decisión

**El repositorio público puede contener extractos reales de la SEC, elegidos,
reducidos y fechados, como oráculo de regresión.** Bajo seis reglas.

1. **Los derechos de `sec-edgar` dejan de decir `unknown` donde la SEC contesta.**
   `rawStorage`, `publicDisplay` y `export` pasan a `allowed`, con
   `rightsReviewedAt` nuevo y esta ADR como evidencia. `aiTransfer` **sigue
   `unknown` a propósito**: la SEC no lo restringe, pero ese campo depende también
   de qué hace el receptor con lo que recibe, y eso es el policy engine de Fase 5
   con su propio gate. Contestarlo acá sería inventar la mitad que falta.
2. **`publicDisplay: allowed` es un derecho, no una superficie.** El gate sigue
   exigiendo `approvalStatus = approved_public_demo` para mostrar datos de la
   fuente en una superficie anónima, y la fuente sigue en `approved_personal`. La
   ADR 0004 no se toca: no hay demo pública, y esta revisión no destraba ninguna.
3. **Un corpus no es un recording.** La prohibición de commitear payloads
   capturados sigue vigente y se precisa, no se afloja. Se distingue por cuatro
   cosas a la vez, y las cuatro tienen que valer:
   - es un **extracto elegido** de la fuente, no lo que pasó por una corrida del
     modo personal;
   - está **reducido** a lo que el oráculo necesita, por versión declarada del
     reductor, que dice qué tiró;
   - viene con **manifiesto**: URL, `accession`, instante de descarga, bytes y
     `sha256` (`TM-16`);
   - proviene de una fuente cuyo contenido es **información pública** y cuyos
     derechos están revisados y `allowed`.
     Un payload íntegro de una ingesta personal no cumple ninguna de las cuatro y
     sigue prohibido.
4. **Atribución sin marca.** El directorio del corpus cita a la SEC como fuente,
   y cada archivo la lleva en su manifiesto. No se copia el sello, ni logos, ni
   artwork, ni se usa `SEC` o `EDGAR` de un modo que sugiera afiliación o
   respaldo. El proyecto no es un espejo de EDGAR: es un puñado de extractos con
   su fecha.
5. **Los derechos son por fuente.** Esta ADR autoriza `sec-edgar` y nada más. Un
   corpus congelado de cualquier otra fuente necesita su propia revisión, aunque
   la fuente parezca abierta: `datahub-sp500-pddl` declara PDDL y sigue en
   `rights_review_pending`.
6. **Congelar no es cachear.** El corpus se descarga una vez, entra al repositorio
   por un diff revisable y no vuelve a la red: ningún test lo refresca, ninguna
   ejecución resuelve «lo último». Actualizarlo es un commit, con su verificación
   de hashes.

## Consecuencias

- El incremento 2 de `F2-06` puede capturar. La captura sale igual por
  `getSourceEgressFetch` y gasta cuota de `sec-edgar`, porque el Fair Access de la
  SEC es sobre el ritmo y no distingue para qué se baja.
- `TM-05` deja de depender sólo de la forma sintética: una respuesta parcial o un
  parser roto contra el cable real pasan a ser detectables. La reconciliación de
  30 empresas y la validación semántica XBRL siguen pendientes; son el gate de
  fase, no este incremento.
- El repositorio crece en bytes. El presupuesto del corpus se declara y se mide en
  el incremento 2, coherente con la frugalidad de las ADR 0017 y 0018: el corpus
  es un oráculo, no un dataset.
- Queda una asimetría honesta y buscada: los derechos de la fuente permiten
  mostrar sus datos en público, y el portal sigue sin hacerlo. La razón es la ADR
  0004, no la licencia.
- La distinción de la regla 3 es ahora parte del contrato: alguien que quiera
  congelar un extracto tiene que poder mostrar las cuatro propiedades. «Es
  público» no alcanza.

## Alternativas descartadas

- **Dejar el fixture sintético y cerrar `F2-06` como está.** Es lo que hay hoy, y
  deja `TM-05` cubierto sólo del lado del parser. El costo aparece cuando la SEC
  cambia algo: nos enteramos por una observación en cuarentena del modo personal,
  o no nos enteramos.
- **Guardar el corpus fuera del repositorio** (una ruta privada, un bucket, LFS
  privado). Conserva la regla actual sin tocarla, pero el oráculo deja de correr
  en CI: un test que se saltea cuando el archivo no está no es un gate. Además
  vuelve irreproducible el repositorio público, que es justo lo que sí puede ser
  público.
- **Sintetizar extractos «parecidos» a los reales a partir de una descarga.**
  Sería lo peor de los dos mundos: tiene el costo de la captura, pierde la
  propiedad que la justifica —que los valores sean los que la SEC publicó— y
  además hace más difícil auditar de dónde salió cada número.
- **Resolver los cuatro derechos de una vez, `aiTransfer` incluido.** Es la
  tentación de cerrar la fila completa. `aiTransfer` no se contesta con los
  términos de la SEC: se contesta con los del receptor, y no hay receptor todavía.
- **Elevar `sec-edgar` a `approved_public_demo` ya que `publicDisplay` es
  `allowed`.** Confunde el derecho con la decisión de producto. La fuente no
  necesita ese estado para nada que exista hoy, y concederlo apagaría el segundo
  cerrojo del gate sin que nadie lo pida.
