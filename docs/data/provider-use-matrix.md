# Matriz de uso personal, cache, retención y cuotas

- Estado: baseline de gobierno; ningún proveedor real está aprobado ni integrado
- Versión: 0.1
- Revisión primaria: 2026-08-21
- Próxima revisión: antes de cada `approved_for_spike` o, como máximo, 90 días
- Registro relacionado: [`source-registry.md`](source-registry.md)
- Alcance: instancia de un solo owner en `personal`; `demo` usa únicamente fixtures

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

| Fuente                    | Uso personal y automatización                                                                                                                                                                                           | Persistencia local propuesta                                                                                                                            | Export, demo pública y transferencia a IA                                                                                              | Resultado de 0B.4                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `sec-edgar`               | Confirmado: acceso público, API sin key, copia y redistribución con cita; automatización sujeta a Fair Access y User-Agent responsable.                                                                                 | `R2 + R3`: filings, submissions y company facts versionados durante la vida de la instancia.                                                            | Export personal permitido con cita. La demo seguirá usando fixtures. IA queda condicional al data map de Fase 7.                       | Elegible para gate del owner; aún no `approved_for_spike`.                 |
| `datahub-sp500-pddl`      | Confirmado bajo PDDL 1.0 para el paquete publicado. Su upstream es Wikipedia y no prueba membresía oficial.                                                                                                             | `R2 + R3`: un snapshot por commit/hash y fecha; no se reescribe.                                                                                        | La licencia admite reutilización; la demo usa fixture propio y el dataset sólo define un universo de desarrollo.                       | Elegible para gate del owner con pin exacto.                               |
| `openfigi`                | Confirmado para FIGI/Open Symbology: uso, almacenamiento y redistribución sin fee; los identificadores de terceros enviados al mapping conservan sus restricciones.                                                     | `R3`; descartar raw después de normalizar salvo fixture sanitizada autorizada.                                                                          | Export de FIGI permitido. No exportar identificadores propietarios de otra fuente por inferencia.                                      | Elegible como reconciliación secundaria, nunca árbitro automático.         |
| `bcra-monetarias-v4`      | Confirmado para integración automatizada y desarrollos internos. El aviso permite reutilización informativa, educativa o académica con cita, contexto íntegro y sin fin comercial.                                      | `R2 + R3`: catálogo, metodología y observaciones fechadas; conservar revisiones. El aviso no fija TTL.                                                  | Atribuir “BCRA” y fecha de descarga. Uso comercial requiere autorización; demo live e IA quedan restringidos.                          | Elegible para gate futuro de Fase 6; revalidar aviso y serie.              |
| `argentina-series-tiempo` | Condicional: el portal promueve reutilización abierta, pero licencia y fuente primaria se verifican por dataset/serie.                                                                                                  | `R2 + R3` sólo con licencia abierta y atribución; si no, no se descarga.                                                                                | Export/display heredan atribución y share-alike del dataset. IA no se autoriza por la licencia general del catálogo.                   | Bloqueado por serie hasta registrar licencia y organismo fuente.           |
| `damodaran-current-data`  | Confirmado para uso en ocupación o research, con atribución y sin revender comercialmente el dataset. Automatización no expresamente garantizada.                                                                       | `R2 + R3`: workbook, hoja, fecha, hash, convención y valores por release.                                                                               | Export interno con atribución; no redistribuir workbook ni vender datos. Demo/IA usan sólo supuestos o derivados permitidos y citados. | Elegible para descarga acotada en Fase 4; no crawling.                     |
| `iso-mic-register`        | Confirmados download y calendario mensual; la publicación fomenta procesamiento automatizado. No se identificó licencia de reutilización.                                                                               | Nada real hasta aclarar derechos. Diseño: `R2 + R3` por publicación y fecha efectiva.                                                                   | Export, redistribución e IA desconocidos.                                                                                              | `blocked_rights`; consultar a la Registration Authority o hallar licencia. |
| `alpaca-market-data`      | Confirmados API, cobertura y cuota de Trading API Basic. El acuerdo individual prohíbe reproducir, distribuir, vender o explotar comercialmente market data sin consentimiento. Retención y derivados no quedan claros. | Sólo `R0 + R1` para una prueba autorizada; no persistir barras reales hasta confirmar por escrito `R2/R3`, duración y obligaciones al terminar el plan. | Export y demo live restringidos. IA desconocida y deshabilitada.                                                                       | `blocked_rights`; la persistencia histórica es condición de adopción.      |
| `caja-valores-cedear`     | Confirmada publicación y descarga; no se hallaron términos que autoricen automatización, cache o historización.                                                                                                         | Nada real. Diseño: snapshot `R2` y mapping/ratio temporal `R3`, sólo con permiso.                                                                       | Export, demo live e IA desconocidos.                                                                                                   | `blocked_rights`; solicitar confirmación a Caja de Valores.                |
| `bna-fx`                  | Confirmada consulta pública del histórico; no se halló API ni permiso suficiente para automatización y retención.                                                                                                       | Nada real. Diseño: `R2 + R3` diario si se autoriza un canal estable.                                                                                    | Export, demo live e IA desconocidos.                                                                                                   | `blocked_rights`; elegir canal y términos concretos en Fase 6.             |
| `bcr-cac-pizarra`         | Confirmada consulta pública, unidad ARS/t y conversión informativa con BNA; automatización y reutilización no documentadas.                                                                                             | Nada real. Diseño: `R2 + R3` por fecha de mercado, publicación, corrección y producto.                                                                  | Export, demo live e IA desconocidos.                                                                                                   | `blocked_rights`; obtener permiso o dataset oficial con licencia.          |

Comafi, BYMA, INDEC directo, Chicago y MEP/CCL no heredan derechos de estas filas.
Entran como `rights_unreviewed` cuando se elija un dataset y endpoint concretos.

## Matriz de cuotas y presupuesto interno

Los límites internos son hard caps, no metas de consumo. Se aplican por fuente y entorno,
incluyen reintentos y quedan por debajo de la cuota publicada cuando existe. Un page view
tiene presupuesto de proveedor igual a cero.

| Fuente                     | Límite externo evidenciado                                                         | Hard cap interno inicial                                           | Cadencia y unidad de trabajo                                                           | Acción al alcanzar límite                                                |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `sec-edgar`                | máximo Fair Access: 10 requests/s agregadas                                        | 2 requests/s, concurrencia 1 y 1.000 requests/run                  | bulk para backfill; submissions detecta cambios; company facts sólo para CIK cambiados | pausar, persistir cursor y reanudar con backoff; nunca rotar IP          |
| `datahub-sp500-pddl`       | sin cuota publicada para el archivo                                                | 2 requests/run y 1 snapshot/día; objetivo mensual o manual         | commit conocido, hash y publicación atómica                                            | conservar snapshot anterior y marcar check fallido                       |
| `openfigi` sin key         | mapping: 25 requests/min y 10 jobs/request; search: 5 requests/min                 | mapping: 12/min; search: 2/min; máximo 250 jobs/run                | batching por identificador + MIC; sólo candidatos ambiguos                             | respetar headers/`429`; checkpoint sin aceptar match ambiguo             |
| `bcra-monetarias-v4`       | control por IP sin cifra; páginas de catálogo 1.000, datos 3.000 y metodología 250 | 30 requests/min, concurrencia 1 y 500 requests/run                 | catálogo/metodología versionados; series elegidas en job diario                        | honrar `Retry-After`; pausar y conservar snapshot                        |
| `argentina-series-tiempo`  | cuota contractual no confirmada                                                    | 30 requests/min, concurrencia 1 y 500 requests/run, sujeto a bajar | catálogo diario y sólo series registradas                                              | `429` abre breaker y suspende la corrida                                 |
| `damodaran-current-data`   | sin cuota publicada                                                                | 1 descarga por dataset/release y máximo 20 archivos/run            | revisión mensual o ante publicación; sin polling frecuente                             | detenerse y conservar release anterior                                   |
| `iso-mic-register`         | publicación mensual, sin cuota publicada                                           | 1 archivo por release y máximo 2 requests/run                      | preferir CSV; pin de publicación y fecha efectiva                                      | no automatizar hasta resolver derechos                                   |
| `alpaca-market-data` Basic | 200 requests históricos/min; histórico desde 2016; últimos 15 minutos restringidos | 100 requests/min, concurrencia 2 y 1.000 requests/run              | barras `1Day` multi-symbol, paginación y job EOD                                       | breaker al 80% del cap interno o primer `429`; conservar cursor/snapshot |
| Caja, BNA y BCR/CAC        | cuota no confirmada                                                                | cero                                                               | no hay job ni refresh real                                                             | permanecer `disabled`                                                    |

Headers más restrictivos siempre mandan. Cada intento futuro escribe en
`provider_usage`: fuente, plan, operación, requests, páginas, filas, ventana, bytes,
status, latencia, costo/créditos, retry, `Retry-After`, cursor y breaker. Los contadores
no se reinician por redeploy ni por invalidar cache.

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
