# Matriz de uso personal, cache, retención y cuotas

- Estado: baseline de gobierno; ningún proveedor real está aprobado ni integrado
- Versión: 0.1
- Revisión primaria: 2026-08-21
- Próxima revisión: antes de cada `approved_for_spike` o, como máximo, 90 días
- Registro relacionado: [`source-registry.md`](source-registry.md)
- Alcance: instancia de un solo owner en `personal`; `demo` usa únicamente fixtures

## Decisión del owner del 2026-08-25

El owner declaró que la aplicación **no tendrá deployment público** y que todo el
uso es particular ([ADR 0004](../architecture/adr/0004-personal-first-runtime.md)).
Eso cambia qué preguntas siguen abiertas en esta matriz:

- Las columnas de **demo pública** y **redistribución** dejan de aplicar: no existe
  una superficie anónima que pueda publicar un dato de tercero. Lo que se conserva
  es la columna de uso e ingesta personal.
- El owner aprueba el **scraping de Comafi** para obtener programas y ratios de
  CEDEAR, y el uso de **Yahoo Finance** para precios, tipo de cambio y granos, ambos
  para consumo personal. Ninguno de los dos cobra ni requiere cuenta.
- Lo que **sigue vigente** es todo lo que protege al propio proyecto: no commitear
  payloads capturados ni credenciales al repositorio público, respetar cuotas y
  backoff para no hacerse bloquear, y conservar provenance y versión de parser para
  poder auditar de dónde salió cada número.
- El presupuesto sigue siendo **cero**: ninguna fuente elegida cobra. Si una fuente
  futura exige pago, es una decisión nueva y explícita.

**Hallazgo del 2026-09-21, al preparar `F7-01`.** Se revisaron los términos de las
candidatas de precios antes de escribir su ADR, y el resultado reordenó la Fase 7:

- **Tiingo** parecía la mejor candidata —contrato explícito, licencia de uso
  personal, y un endpoint que devuelve OHLC sin ajustar con `divCash` y
  `splitFactor` fechados en una sola request— hasta leer sus ToU. El §1.6(a)
  **prohíbe al plan gratuito persistir el dato en una base**, que es literalmente
  lo que `F7-01` construye. La página de precios no lo dice; sólo los términos. Es
  el mismo error que `F2-06` ya había documentado en sentido inverso: la
  conclusión de derechos vive en los términos, no en la página del producto, y no
  vale hasta que baja a la fila del registro.
- **Yahoo** funciona técnicamente —una request sin credencial devuelve 1.254
  cierres diarios y 20 dividendos fechados— pero no concede nada: no hay contrato.
- El resto del panorama gratuito tiene la misma forma: o prohíbe persistir, o no
  concede nada.

Por eso la Fase 7 arrancó por `F7-02`, que no necesita precios.

**Decisión del owner del 2026-09-22.** Entre pagar un plan, incumplir un contrato
aceptado o usar una fuente sin contrato, eligió **Yahoo**
([ADR 0026](../architecture/adr/0026-daily-prices-source.md)). El razonamiento que
queda registrado: aceptar los términos de Tiingo para después violar una cláusula
concreta expone más que no tener contrato —hay cuenta, identidad y una key que
cortan sin aviso, y el incumplimiento quedaría escrito en un repositorio
público—, y da lo mismo que Yahoo con un contrato roto encima.

Eso obligó a una decisión de vocabulario: el gate de ingesta exige `allowed`, y
marcar así a Yahoo habría corrompido el significado del valor del que depende todo
el gate. Los derechos ganaron `owner_accepted` —«nadie lo concede; el owner
decidió proceder igual»—, que habilita una corrida pero **nunca** una superficie
pública.

<a id="cedear"></a>

**Hallazgo del 2026-09-23, al preparar `F7-03`.** La aprobación del 2026-08-25 decía
«scraping de Comafi». Al medirla aparecieron tres cosas que la cambiaban:

- **hay dos emisores**, no uno: la CNV autoriza a Banco Comafi y a Caja de Valores,
  y no comparten ningún subyacente. Contra el S&P 500 del grafo personal, Caja de
  Valores es el único emisor de F, UAL, MU, OXY, UBER, PANW, MOS y ABNB: un registro
  sólo de Comafi diría de esas ocho que no tienen CEDEAR, y una tabla parcial no
  prueba una ausencia;
- **Comafi prohíbe almacenar, por escrito.** Sus
  [términos legales](https://www.comafi.com.ar/1759-Terminos-Y-Condiciones-Legales-De-Banco-Comafi.note.aspx)
  y el pie de la página de programas dicen «Prohibida la duplicación, distribución o
  almacenamiento en cualquier medio». No es un «no se concede», como Yahoo: es una
  prohibición, y la aprobación era anterior a leerla;
- **Caja de Valores no publica términos** de uso para su sitio: ni concede ni
  prohíbe.

**Decisión del owner del 2026-09-23.** Usar **las dos fuentes**, las dos en
`owner_accepted`, con la cláusula de Comafi citada en su fila del registro en vez de
resumida ([ADR 0027](../architecture/adr/0027-cedear-registry-sources.md)). Lo que
se guarda son hechos normalizados —programa, ISIN, código de Caja de Valores, ratio
y subyacente resuelto—; ningún payload, y las fixtures de los tests son sintéticas.

Las filas de abajo conservan su revisión de términos como registro histórico. Su
columna de resultado se relee bajo esta decisión.

## Propósito

Esta matriz convierte términos, avisos legales y límites técnicos en restricciones
ejecutables para el portal. Registra por fuente qué uso puede defenderse con evidencia
primaria, qué persistencia necesita el producto y qué presupuesto interno deberá aplicar
el adaptador. No es asesoramiento legal ni sustituye el plan o contrato que el owner
acepte en el futuro.

Completar este documento no autoriza una integración. Todas las fuentes permanecen en
`rights_review_pending` o `rights_unreviewed` hasta que el owner apruebe un spike
concreto. Crear una cuenta, aceptar términos, pagar, usar una credencial o descargar un
payload real exige ese gate posterior.

## Regla de decisión

- `confirmado`: una fuente primaria vigente cubre el uso indicado.
- `condicional`: el permiso depende del plan, dataset, atribución o configuración.
- `desconocido`: la evidencia revisada no lo dice; falla cerrado.
- `restringido`: la evidencia lo prohíbe o el producto decidió no hacerlo.

Una página pública, un botón de descarga o un endpoint funcional no convierten
`desconocido` en `confirmado`. Ante conflicto, manda el contrato o plan concreto más
restrictivo. El estado se degrada a `suspended` cuando vence la revisión, cambian los
términos o no puede reconstruirse la evidencia.

## Clases de persistencia del portal

| Clase                | Contenido                                                                            | Retención local objetivo                                                                      | Cache de Next.js                            | Borrado                                                                     |
| -------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| `R0 transient`       | buffer necesario para validar y normalizar                                           | memoria o staging cifrado; máximo 24 horas y fuera de backups                                 | nunca                                       | automático al publicar o fallar la corrida                                  |
| `R1 operations`      | requests, páginas, bytes, latencia, status, backoff y costo; sin secretos ni payload | 90 días móviles                                                                               | nunca                                       | mantenimiento futuro y borrado manual                                       |
| `R2 source snapshot` | documento o payload raw permitido, hash, parser y provenance                         | vida de la instancia para reproducibilidad; sin TTL silencioso                                | nunca como almacenamiento                   | manual o por obligación contractual; conservar tombstone/hash si se permite |
| `R3 normalized`      | observaciones, identidades, mappings, transformaciones y derivados permitidos        | vida de la instancia o hasta borrado manual                                                   | sólo DTO derivado, separado por modo y tags | borrado explícito con invalidación de dependencias                          |
| `R4 AI trace`        | evidence IDs, input minimizado, política, routing, costo y output aceptado           | output aceptado junto al snapshot; intentos no aceptados 90 días; prompt completo desactivado | nunca                                       | manual, incluidas copias locales controladas                                |

`R2` sólo existe si la fila permite raw. Si no, la observación usa
`raw_value_status=license_restricted` y conserva únicamente identificadores, hashes y
transformaciones autorizados. Backups heredan la misma política y no extienden un plazo
contractual.

La cache de Next.js es derivada y descartable. No contiene respuestas raw, credenciales,
documentos licenciados ni datos que puedan cruzar `personal | demo`. Invalidarla nunca
borra Postgres ni reinicia un presupuesto.

## Matriz de derechos y retención

| Fuente                    | Uso personal y automatización                                                                                                                                                                                                                                                                                                                                                                                                                                       | Persistencia local propuesta                                                                                                                                  | Export, demo pública y transferencia a IA                                                                                                                                                                                                      | Resultado de 0B.4                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sec-edgar`               | Confirmado: acceso público, API sin key, copia y redistribución con cita; automatización sujeta a Fair Access y User-Agent responsable.                                                                                                                                                                                                                                                                                                                             | `R2 + R3`: filings, submissions y company facts versionados durante la vida de la instancia.                                                                  | Export personal permitido con cita. La demo seguirá usando fixtures. IA queda condicional al data map de Fase 7.                                                                                                                               | Elegible para gate del owner; aún no `approved_for_spike`.                                                                                                            |
| `datahub-sp500-pddl`      | Confirmado bajo PDDL 1.0 para el paquete publicado. Su upstream es Wikipedia y no prueba membresía oficial.                                                                                                                                                                                                                                                                                                                                                         | `R2 + R3`: un snapshot por commit/hash y fecha; no se reescribe.                                                                                              | La licencia admite reutilización; la demo usa fixture propio y el dataset sólo define un universo de desarrollo.                                                                                                                               | Elegible para gate del owner con pin exacto.                                                                                                                          |
| `openfigi`                | Confirmado para FIGI/Open Symbology: uso, almacenamiento y redistribución sin fee; los identificadores de terceros enviados al mapping conservan sus restricciones.                                                                                                                                                                                                                                                                                                 | `R3`; descartar raw después de normalizar salvo fixture sanitizada autorizada.                                                                                | Export de FIGI permitido. No exportar identificadores propietarios de otra fuente por inferencia.                                                                                                                                              | Elegible como reconciliación secundaria, nunca árbitro automático.                                                                                                    |
| `bcra-monetarias-v4`      | Confirmado para integración automatizada y desarrollos internos. El aviso permite reutilización informativa, educativa o académica con cita, contexto íntegro y sin fin comercial.                                                                                                                                                                                                                                                                                  | `R2 + R3`: catálogo, metodología y observaciones fechadas; conservar revisiones. El aviso no fija TTL.                                                        | Atribuir “BCRA” y fecha de descarga. Uso comercial requiere autorización; demo live e IA quedan restringidos.                                                                                                                                  | Elegible para gate futuro de Fase 6; revalidar aviso y serie.                                                                                                         |
| `argentina-series-tiempo` | Condicional: el portal promueve reutilización abierta, pero licencia y fuente primaria se verifican por dataset/serie.                                                                                                                                                                                                                                                                                                                                              | `R2 + R3` sólo con licencia abierta y atribución; si no, no se descarga.                                                                                      | Export/display heredan atribución y share-alike del dataset. IA no se autoriza por la licencia general del catálogo.                                                                                                                           | Bloqueado por serie hasta registrar licencia y organismo fuente.                                                                                                      |
| `damodaran-current-data`  | Confirmado para uso en ocupación o research, con atribución y sin revender comercialmente el dataset. Automatización no expresamente garantizada.                                                                                                                                                                                                                                                                                                                   | `R2 + R3`: workbook, hoja, fecha, hash, convención y valores por release.                                                                                     | Export interno con atribución; no redistribuir workbook ni vender datos. Demo/IA usan sólo supuestos o derivados permitidos y citados.                                                                                                         | Elegible para descarga acotada en Fase 4; no crawling.                                                                                                                |
| `iso-mic-register`        | Confirmados download y calendario mensual; la publicación fomenta procesamiento automatizado. No se identificó licencia de reutilización.                                                                                                                                                                                                                                                                                                                           | Nada real hasta aclarar derechos. Diseño: `R2 + R3` por publicación y fecha efectiva.                                                                         | Export, redistribución e IA desconocidos.                                                                                                                                                                                                      | `blocked_rights`; consultar a la Registration Authority o hallar licencia.                                                                                            |
| `alpaca-market-data`      | Confirmados API, cobertura y cuota de Trading API Basic. El acuerdo individual prohíbe reproducir, distribuir, vender o explotar comercialmente market data sin consentimiento. Retención y derivados no quedan claros.                                                                                                                                                                                                                                             | Sólo `R0 + R1` para una prueba autorizada; no persistir barras reales hasta confirmar por escrito `R2/R3`, duración y obligaciones al terminar el plan.       | Export y demo live restringidos. IA desconocida y deshabilitada.                                                                                                                                                                               | `blocked_rights`; la persistencia histórica es condición de adopción.                                                                                                 |
| `yahoo-finance`           | **Sin concesión contractual.** El endpoint no está documentado como API pública y los términos de Yahoo no autorizan la extracción automatizada; que responda `200` no convierte `desconocido` en `confirmado`. El owner decidió usarlo igual el 2026-09-22 para consumo personal, con la decisión fechada y motivada ([ADR 0026](../architecture/adr/0026-daily-prices-source.md)).                                                                                | `R1 + R3`: cierres crudos y eventos fechados. El payload **no** se conserva (`rawStorage: restricted`).                                                       | Export personal. Display público e IA restringidos: una decisión del owner asume un riesgo propio y no fabrica un derecho frente a terceros.                                                                                                   | `approved_personal` con derechos en `owner_accepted`, nunca `allowed`.                                                                                                |
| `tiingo-eod`              | **Restringido para este producto en el plan gratuito.** Los ToU (§1.6(a), actualizados el 2026-08-05) prohíben al Starter Plan «write, save, archive, back up, or otherwise retain Tiingo Data in any persistent or durable storage», nombrando **bases de datos** entre los sistemas alcanzados; sólo permiten memoria volátil o cache no persistente durante la operación. El plan pago (Power, USD 30/mes individual) sí permite persistir mientras está activo. | Nada real en el plan gratuito: la tabla de precios de `F7-01` es exactamente lo que §1.6(a) prohíbe. Con plan pago, `R3` mientras la suscripción siga activa. | Export y display a terceros restringidos («internal use means you may not display or share the data with another person or organization»). Los _Derived Products_ (§1.6(c)) se pueden conservar si no permiten reconstruir el dato subyacente. | `blocked_rights` en el plan gratuito, por la misma razón que Alpaca: **la persistencia es la condición de adopción**. Elegible sólo como decisión de gasto explícita. |
| `comafi-cedear`           | **Prohíbe almacenar, por escrito**: «Prohibida la duplicación, distribución o almacenamiento en cualquier medio». Emite 364 de los programas. El owner decidió usarlo igual el 2026-09-23, con la cláusula citada ([ADR 0027](../architecture/adr/0027-cedear-registry-sources.md)).                                                                                                                                                                                | `R3`: programa y ratio versionados, CEDEAR como security propia. El JSON **no** se conserva (`rawStorage: restricted`).                                       | Export personal. Display público e IA restringidos.                                                                                                                                                                                            | `approved_personal` con derechos en `owner_accepted`, nunca `allowed`.                                                                                                |
| `caja-valores-cedear`     | Sin términos publicados para el sitio: ni concede ni prohíbe. Es el segundo emisor autorizado por la CNV (59 programas). El owner decidió usarlo el 2026-09-23 ([ADR 0027](../architecture/adr/0027-cedear-registry-sources.md)).                                                                                                                                                                                                                                   | `R3`: programa y ratio versionados, CEDEAR como security propia. El HTML **no** se conserva (`rawStorage: restricted`).                                       | Export personal. Display público e IA restringidos.                                                                                                                                                                                            | `approved_personal` con derechos en `owner_accepted`, nunca `allowed`.                                                                                                |
| `bna-fx`                  | Confirmada consulta pública del histórico; no se halló API ni permiso suficiente para automatización y retención.                                                                                                                                                                                                                                                                                                                                                   | Nada real. Diseño: `R2 + R3` diario si se autoriza un canal estable.                                                                                          | Export, demo live e IA desconocidos.                                                                                                                                                                                                           | `blocked_rights`; elegir canal y términos concretos en Fase 6.                                                                                                        |
| `bcr-cac-pizarra`         | Confirmada consulta pública, unidad ARS/t y conversión informativa con BNA; automatización y reutilización no documentadas.                                                                                                                                                                                                                                                                                                                                         | Nada real. Diseño: `R2 + R3` por fecha de mercado, publicación, corrección y producto.                                                                        | Export, demo live e IA desconocidos.                                                                                                                                                                                                           | `blocked_rights`; obtener permiso o dataset oficial con licencia.                                                                                                     |

BYMA, INDEC directo, Chicago y MEP/CCL no heredan derechos de estas filas.
Entran como `rights_unreviewed` cuando se elija un dataset y endpoint concretos.

## Matriz de cuotas y presupuesto interno

Los límites internos son hard caps, no metas de consumo. Se aplican por fuente y entorno,
incluyen reintentos y quedan por debajo de la cuota publicada cuando existe. Un page view
tiene presupuesto de proveedor igual a cero.

| Fuente                                  | Límite externo evidenciado                                                         | Hard cap interno inicial                                                                                                                                                                                          | Cadencia y unidad de trabajo                                                                                                                                                   | Acción al alcanzar límite                                                                                                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sec-edgar`                             | máximo Fair Access: 10 requests/s agregadas                                        | 2 requests/s, concurrencia 1 y 1.000 requests/run —implementados en `F2-03`—; **2.000 requests/día por fuente, contados en PostgreSQL** —`F2-05` inc. 3—; hasta 64 archivos históricos de submissions por empresa | backfill por empresa como job durable con lease por fuente y reserva de 66 requests por empresa (ADR 0015); submissions detecta cambios; company facts sólo para CIK cambiados | pausar el job con `not_before`, persistir cursor y reanudar con backoff —implementado en `F2-05`—; agotado el día, la corrida para y el contador se repone a las 00:00Z; el owner puede frenar la fuente con `pnpm ingestion:sources --disable`; nunca rotar IP |
| `datahub-sp500-pddl`                    | sin cuota publicada para el archivo                                                | 2 requests/run, 4 por proceso y **10 requests/día**; 1 snapshot/día; objetivo mensual o manual                                                                                                                    | commit conocido, hash y publicación atómica                                                                                                                                    | conservar snapshot anterior y marcar check fallido                                                                                                                                                                                                              |
| `openfigi` sin key                      | mapping: 25 requests/min y 10 jobs/request; search: 5 requests/min                 | mapping: 12/min; search: 2/min; máximo 250 jobs/run                                                                                                                                                               | batching por identificador + MIC; sólo candidatos ambiguos                                                                                                                     | respetar headers/`429`; checkpoint sin aceptar match ambiguo                                                                                                                                                                                                    |
| `bcra-monetarias-v4`                    | control por IP sin cifra; páginas de catálogo 1.000, datos 3.000 y metodología 250 | 30 requests/min, concurrencia 1 y 500 requests/run                                                                                                                                                                | catálogo/metodología versionados; series elegidas en job diario                                                                                                                | honrar `Retry-After`; pausar y conservar snapshot                                                                                                                                                                                                               |
| `argentina-series-tiempo`               | cuota contractual no confirmada                                                    | 30 requests/min, concurrencia 1 y 500 requests/run, sujeto a bajar                                                                                                                                                | catálogo diario y sólo series registradas                                                                                                                                      | `429` abre breaker y suspende la corrida                                                                                                                                                                                                                        |
| `damodaran-current-data`                | sin cuota publicada                                                                | 1 descarga por dataset/release y máximo 20 archivos/run                                                                                                                                                           | revisión mensual o ante publicación; sin polling frecuente                                                                                                                     | detenerse y conservar release anterior                                                                                                                                                                                                                          |
| `iso-mic-register`                      | publicación mensual, sin cuota publicada                                           | 1 archivo por release y máximo 2 requests/run                                                                                                                                                                     | preferir CSV; pin de publicación y fecha efectiva                                                                                                                              | no automatizar hasta resolver derechos                                                                                                                                                                                                                          |
| `alpaca-market-data` Basic              | 200 requests históricos/min; histórico desde 2016; últimos 15 minutos restringidos | 100 requests/min, concurrencia 2 y 1.000 requests/run                                                                                                                                                             | barras `1Day` multi-symbol, paginación y job EOD                                                                                                                               | breaker al 80% del cap interno o primer `429`; conservar cursor/snapshot                                                                                                                                                                                        |
| `yahoo-finance`                         | sin cuota publicada                                                                | 1 request/s, concurrencia 1 y 600 requests/run; **700 requests/día por fuente**, contados en PostgreSQL                                                                                                           | una request por security trae cinco años de cierres más splits y dividendos; job a mano, nunca programado                                                                      | el tope diario para la corrida y el contador se repone a las 00:00Z; el owner puede frenar la fuente con `pnpm ingestion:sources --disable`                                                                                                                     |
| `comafi-cedear` / `caja-valores-cedear` | sin cuota publicada                                                                | 1 request/s, concurrencia 1 y 4 requests/run; **10 requests/día por fuente**, contados en PostgreSQL                                                                                                              | una request por emisor trae su registro entero; job a mano, semanal o ante un aviso del emisor                                                                                 | el tope diario corta la corrida; el owner puede frenar cada fuente con `pnpm ingestion:sources --disable`                                                                                                                                                       |
| Caja, BNA y BCR/CAC                     | cuota no confirmada                                                                | cero                                                                                                                                                                                                              | no hay job ni refresh real                                                                                                                                                     | permanecer `disabled`                                                                                                                                                                                                                                           |

Headers más restrictivos siempre mandan. Cada intento futuro escribe en
`provider_usage`: fuente, plan, operación, requests, páginas, filas, ventana, bytes,
status, latencia, costo/créditos, retry, `Retry-After`, cursor y breaker. Los contadores
no se reinician por redeploy ni por invalidar cache.

Desde la [ADR 0020](../architecture/adr/0020-source-daily-budget-kill-switch.md) los
topes diarios de esta tabla son ejecutables: `SOURCE_DAILY_REQUEST_BUDGETS` los declara
en código y `ingestion_source_budgets` los cuenta por fuente y día UTC, compartido por
todos los procesos. **Una fuente que no figure en esa constante no emite ninguna
llamada**, aunque esté en la allowlist de egress y tenga derechos aprobados. El owner
puede bajar un tope o frenar una fuente con `pnpm ingestion:sources`; subirlo es un
cambio de código. Cambiar una cifra de esta tabla obliga a cambiar la constante en el
mismo diff.

## Servicios que reciben datos del portal

### OpenRouter

- Diferido a Fase 7 y presupuesto efectivo `USD 0` hasta aprobación.
- OpenRouter declara no conservar prompts/respuestas salvo opt-in, pero guarda metadata.
  ZDR debe exigirse por request y sólo enruta a endpoints compatibles; su definición
  permite cache implícita en memoria.
- `data_collection=deny`, allowlist de modelos/proveedores y prompt logging desactivado
  son requisitos acumulativos.
- No se envían raw licenciados, documentos privados, credenciales, portfolios, datos
  personales ni texto que otra fuente prohíba transferir.
- Localmente se usa `R4`; el replay usa el output aceptado y no invoca nuevamente IA.
- Techo candidato no aprobado: USD 0,25/request, USD 2/día, USD 10/mes,
  20 requests/día y concurrencia 1. El menor límite entre key, guardrail y app manda.

### Tavily

- Diferido a Fase 7 y presupuesto efectivo `USD 0` hasta aprobación.
- Researcher publica 1.000 créditos/mes; search básico cuesta 1 y advanced 2. Development
  publica 100 requests/min, pero términos y privacidad permiten procesamiento amplio del
  input y compartir queries con índices de terceros.
- Sólo se permitirían queries públicas, allowlist de dominios,
  `include_answer=false` e `include_raw_content=false`. Nunca datos del owner, tesis
  privadas, prompts internos ni payloads de otro proveedor.
- Persistencia local: URL, título, fecha, hash y fragmento breve; no una copia íntegra ni
  el output como dato financiero.
- Techo candidato no aprobado: 10 requests/min, 10 créditos/día y 100/mes. Advanced,
  Extract, Crawl y Research permanecen deshabilitados hasta un gate específico.

## Confirmaciones obligatorias antes de los primeros spikes

### Alpaca

El owner debe conservar evidencia del plan y obtener respuesta escrita o contractual a:

1. si un usuario individual no profesional puede guardar barras diarias históricas en una
   base privada y por cuánto tiempo;
2. si puede conservar normalizados, ajustes de corporate actions y derivados;
3. si puede mostrarlos al mismo owner en localhost/deployment protegido y exportar un CSV
   exclusivamente personal;
4. qué cambia entre IEX y SIP demorado para EOD;
5. qué debe borrarse al cancelar o cambiar el plan.

Si no se permite `R3` durante la vida de la instancia, Alpaca se rechaza: volver a pedir
históricos en cada sesión contradice la arquitectura y el presupuesto.

### Caja de Valores, BNA, BCR/CAC e ISO MIC

Se necesita identificar términos o una confirmación sobre automatización, snapshots,
normalización, atribución, export personal y plazo de retención. La ausencia de respuesta
no habilita scraping; obliga a elegir una alternativa o mantener la capacidad `disabled`.

## Gate para cambiar una fila a `approved_for_spike`

1. Dataset, endpoint, plan y versión de términos están identificados.
2. La revisión primaria tiene menos de 90 días y sus URLs/hash están registrados.
3. Raw, normalizados, derivados, export, display e IA tienen valor no ambiguo.
4. El owner aprueba cuenta, términos, costo máximo y alcance de la prueba.
5. Existen schema Zod, fixture permitida, identidad, point-in-time y casos de `429`,
   timeout, parcial y cambio de schema.
6. El adaptador implementa hard cap, uso durable, backoff, cursor y breaker.
7. La prueba no publica datos live ni los mezcla con fixtures de `demo`.
8. Existe estrategia de salida: export autorizado, borrado, reemplazo y snapshot válido.

Una ADR posterior al spike decide `approved_personal`, presupuesto y fallback.

## Evidencia primaria revisada

- SEC: [API EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces),
  [Fair Access](https://www.sec.gov/filergroup/announcements-old/new-rate-control-limits) y
  [difusión](https://www.sec.gov/about/privacy-information).
- Alpaca: [planes](https://docs.alpaca.markets/us/docs/about-market-data-api),
  [barras](https://docs.alpaca.markets/us/v1.1/reference/stockbarsingle-1) y
  [acuerdos](https://alpaca.markets/disclosures).
- DataHub/PDDL: [repositorio](https://github.com/datasets/s-and-p-500-companies) y
  [PDDL 1.0](https://opendatacommons.org/licenses/pddl/).
- OpenFIGI: [API](https://www.openfigi.com/api/documentation),
  [términos](https://www.openfigi.com/docs/terms-of-service) y
  [FAQ](https://www.openfigi.com/docs/faqs).
- ISO MIC: [registro oficial](https://www.iso20022.org/market-identifier-codes).
- BCRA: [APIs](https://www.bcra.gob.ar/apis-banco-central/) y
  [aviso legal](https://www.bcra.gob.ar/aviso-legal/).
- Datos Argentina: [Series de Tiempo](https://www.datos.gob.ar/dataset/jgm_3/archivo/jgm_3.13)
  y [dato abierto](https://www.datos.gob.ar/acerca/seccion/Glosario).
- Caja: [listado CEDEAR](https://cajadevalores.com.ar/Servicios/Cedears).
- BNA: [histórico](https://www.bna.com.ar/Cotizador/MonedasHistorico).
- BCR/CAC: [pizarra](https://www.cac.bcr.com.ar/es/precios-de-pizarra).
- Damodaran: [reglas de uso](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/guide.html).
- OpenRouter: [ZDR](https://openrouter.ai/docs/guides/features/zdr),
  [data collection](https://openrouter.ai/docs/guides/privacy/data-collection),
  [guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview) y
  [términos](https://openrouter.ai/terms/).
- Tavily: [créditos](https://docs.tavily.com/documentation/api-credits),
  [rate limits](https://docs.tavily.com/documentation/rate-limits),
  [términos](https://www.tavily.com/terms) y [privacidad](https://www.tavily.com/privacy).
