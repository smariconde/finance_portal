# ADR 0009: frontera de egress y defensa SSRF

- Estado: aceptado
- Fecha: 2026-09-05
- Alcance: habilita la primera salida a red del proyecto; cierra los controles de
  `TM-08` que el [threat model](../../security/threat-model.md) exige **antes** del
  primer extractor
- Decisiones relacionadas: [ADR 0004](0004-personal-first-runtime.md) (un runtime
  trabado no consulta ninguna fuente), [ADR 0007](0007-ticker-driven-valuation-pivot.md)
  (el provider de la SEC es `F2-03`)

## Contexto

Hasta este slice el repositorio no abría un socket hacia afuera: el fake provider
sirve fixtures y la suite unitaria corre detrás de un guard que hace fallar `fetch`,
`http`, `https` y TCP crudo. `F2-03` necesita traer datos de la SEC, y el threat
model condiciona esa primera salida a tener resueltos HTTPS forzado, allowlist,
validación de resolución y redirects, bloqueo de rangos privados y límites de
tamaño y tiempo.

El riesgo concreto de `TM-08` no es que el código pida una URL rara a propósito. Es
que un nombre aprobado deje de apuntar a donde apuntaba —DNS comprometido, un CNAME
que cambia, un redirect hostil— y el runtime termine hablando con `127.0.0.1`, con
la red privada donde vive PostgreSQL, o con el endpoint de metadata de la nube que
en Vercel o en cualquier hosting entrega credenciales de instancia.

## Decisión

### No existe una función que acepte una URL sola

Toda salida se autoriza contra la entrada de allowlist de **una** fuente, y la
entrada empareja host con prefijos de path. Un adaptador de proveedor construye el
path de su recurso; no elige a dónde va el socket. Esto hace estructural el
requisito del threat model de que los adaptadores reciban «IDs o dominios
aprobados, no URL arbitraria».

La allowlist concede **alcanzabilidad, no permiso**. Que `sec-edgar` esté en ella no
significa que se pueda ingerir de la SEC: eso lo decide el gate de derechos del
registro de fuentes, que corre antes y por separado. Son dos controles a propósito
—uno responde «¿a dónde se puede abrir un socket?» y el otro «¿tenemos derecho a
estos datos?»— y ninguno cubre al otro. Hoy `sec-edgar` es alcanzable y **no** es
ingerible: sus derechos siguen en `rights_review_pending`.

### Se usa `node:https` y no `fetch`, para poder fijar la dirección

Validar la dirección por separado y después llamar a `fetch` deja una ventana: entre
la comprobación y la conexión, el cliente HTTP hace su **propia** resolución del
nombre, que puede devolver otra dirección. Es el ataque de DNS rebinding, y no lo
cierra revisar más rápido.

`fetch` no expone el `lookup` del socket. `node:https` sí, y ahí la comprobación
**es** la resolución: la función que valida se le pasa a la request como su
`lookup`, así que el socket sólo puede abrirse contra direcciones ya aprobadas. No
queda una segunda resolución sin vigilar.

La alternativa era agregar `undici` como dependencia directa para usar su
`connect.lookup`. Se descartó: `node:https` es builtin, el cliente que hace falta es
un `GET` con techo de bytes y deadline, y `TM-13` prefiere no sumar superficie de
supply chain para eso.

Consecuencia operativa: el agente es propio y con `keepAlive: false`. Desde Node 19
el agente global reusa conexiones, y una conexión reusada no vuelve a resolver el
nombre —heredaría un socket abierto sin pasar por el guard—.

### Una dirección no pública rechaza la conexión entera

Si **alguna** de las direcciones a las que resuelve el nombre no es públicamente
ruteable, la conexión falla; no se filtran las malas para conectarse a las buenas.
Filtrar alcanzaría para no entrar a la red privada, pero dejaría pasar en silencio a
un host aprobado que empezó a resolver a `127.0.0.1`. Eso no es un detalle a
tolerar: es la señal de que el nombre dejó de ser el que se aprobó, y el resultado
correcto es un fallo nombrado, no una conexión que anda.

### Lo que no se entiende como dirección, se rechaza

El parser acepta una única forma canónica. `0177.0.0.1`, `2130706433` y `0x7f.0.0.1`
son todas `127.0.0.1` para `inet_aton`; acá no son direcciones y caen en
`unparsable`, que es una negativa. Reimplementar la tabla de formas heredadas es
justamente donde viven los bypasses.

Los tres prefijos IPv6 que embeben una IPv4 real —mapped `::ffff:0:0/96`, NAT64
`64:ff9b::/96` y 6to4 `2002::/16`— se clasifican por la dirección embebida.
`::ffff:127.0.0.1` abre el mismo socket que `127.0.0.1`; juzgarlo por su prefijo
IPv6 lo daría por público.

### Cada redirect vuelve a pasar por la allowlist

Un `Location` se resuelve contra el salto actual y el destino resultante se
re-autoriza completo: esquema, credenciales, puerto, host y prefijo de path. Un
redirect fuera del host aprobado, o hacia otro path del mismo host, corta la cadena
antes de emitir la segunda petición.

El presupuesto de tiempo es **uno para la operación completa**, no uno por salto: un
timeout por salto deja que una cadena de redirects multiplique el presupuesto.

### El runtime se identifica con un contacto real, o no sale

La Fair Access de la SEC exige que el tráfico automatizado se presente con un
contacto al que responder. Eso no se puede satisfacer con una constante del
repositorio: el código es público, y un default haría que toda instancia se
presentara igual. Sale de `SEC_USER_AGENT`, y un runtime personal sin esa variable
se niega a salir.

El valor termina en un header, así que se valida como tal: sólo ASCII imprimible, de
modo que un `\r\n` embebido no pueda partir el request e inyectar headers propios.

### El egress falla cerrado igual que la persistencia

`getEgressClient()` construye a través de `selectPersonalDependency()` y lanza
`RuntimeLockedError` en un runtime trabado, antes de resolver un nombre y antes de
leer la identificación del owner. Un runtime que no probó ser privado no genera
tráfico ni revela por DNS que existe (ADR 0004).

## Consecuencias

- El módulo vive completo en [`src/server/egress/`](../../../src/server/egress/).
  `https-transport.ts` es el único archivo del proyecto que importa `node:https`.
- El guard de red de la suite unitaria **no** se relaja. La política se prueba con un
  resolver y un transporte inyectados; ningún test abre un socket.
- Sin cliente que reintente: `429` y `503` se devuelven con su `Retry-After` para que
  el llamador decida. Reintentar acá escondería el consumo de cuota del presupuesto.

## Lo que esta ADR **no** decide

- **Ritmo y presupuesto (`TM-10`, `TM-11`).** La matriz de cuotas fija para
  `sec-edgar` 2 requests/s, concurrencia 1 y 1.000 requests por corrida. Nada de eso
  está implementado: este cliente no espacia ni cuenta llamadas. Se cierra con el
  provider y el backfill durable (`F2-03`, `F2-05`), y hasta entonces el egress es
  para llamadas puntuales y verificables, no para un job.
- **Qué se ingiere y con qué derechos.** Sigue siendo del registro de fuentes.
- **Compresión.** Se pide `identity` a propósito: el techo de bytes se aplica sobre lo
  que se recibe, y un cuerpo comprimido escondería su tamaño real detrás de la
  descompresión. Si el volumen lo justifica, el cambio necesita medir el techo sobre
  el stream descomprimido.
