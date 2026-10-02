# ADR 0033: capa IA acotada, empezando por la industria ambigua

- Estado: aceptado
- Fecha: 2026-10-02
- Alcance: Fase 5 (`F5-01` a `F5-04` y `F5-06`), adelantada antes de la Fase 4 con
  un primer caso: resolver la industria de Damodaran cuando el SIC no alcanza.
  Decide los dos proveedores, cómo salen las llamadas, cuánto pueden gastar, cómo
  se elige el modelo, qué evidencia recibe, cuándo una respuesta se acepta y
  dónde queda.
- Decisiones relacionadas: [ADR 0007](0007-ticker-driven-valuation-pivot.md)
  (la IA propone, el motor calcula), [ADR 0009](0009-egress-boundary.md) (una
  sola puerta de salida, que esta ADR enmienda),
  [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota diaria y kill
  switch), [ADR 0023](0023-frozen-sec-extracts-rights.md) (derechos de la SEC),
  [ADR 0025](0025-declared-sector-classification.md) (clasificaciones como
  aserciones), [ADR 0031](0031-on-demand-company-assessment.md) (evaluación a
  demanda)

## Contexto

`sic-damodaran-industry-1.0.0` (`F3-05`) mapea cada SIC a las industrias de
Damodaran que puede ser. De sus 418 códigos, 87 tienen más de una candidata, y en
la muestra del gate de la Fase 3 **16 de 30 empresas quedaron ambiguas**. Sin
industria no hay beta, y sin beta no hay costo de capital: más de la mitad de la
muestra no llega al WACC por una pregunta que un analista contesta leyendo el
Item 1 del 10-K.

Hoy esa ambigüedad sólo la resuelve una declaración del owner por CIK con motivo
escrito, y la lista está vacía. El owner decidió el 2026-10-02 que lo mecanizable
se mecaniza y lo que pide criterio lo resuelve una IA con búsqueda, diciendo por
qué en cada caso. Eso es exactamente la frontera de la ADR 0007: la clasificación
de industria es la primera fila de la tabla de decisiones cualitativas que la IA
puede tomar. Lo que cambia es el orden: la Fase 5 estaba detrás de la Fase 4, y
este caso no necesita nada de la Fase 4.

## Decisión 1 — la Fase 5 empieza ahora, por un caso cerrado

Se adelanta la Fase 5 antes de la Fase 4, y su primer caso es la industria
ambigua. Es el mejor primer caso posible para la capa:

- la respuesta es **cerrada**: una de las candidatas que el SIC ya nombra, o
  abstenerse. La IA no puede inventar una industria ni producir una cifra;
- la evidencia es **primaria y pública**: el 10-K de la SEC, cuyos derechos ya
  son `allowed`;
- el efecto es **medible**: cuántas de las 16 ambiguas de la muestra quedan
  resueltas, con qué citas y a qué costo.

Los controles que la Fase 5 pedía antes de la primera llamada —presupuesto,
breaker, kill switch, guard de modo— se construyen en el mismo orden: ninguna
llamada sale hasta que existan. El resto de la Fase 5 (supuestos `F5-05`, evals
`F5-07`) y la Fase 4 conservan su alcance. Orden de ejecución: 2 → 7 → 3 → 5 → 4
→ 6 → 8 → 9 → 10.

## Decisión 2 — proveedores: OpenRouter para modelos, Tavily para búsqueda

**OpenRouter** (cuenta del owner) da una sola clave para modelos de varias
familias y permite exigir, por request, enrutamiento a endpoints con retención
cero (`provider.zdr: true`) y sin recolección de datos
(`provider.data_collection: "deny"`). Devuelve en cada respuesta el modelo que
efectivamente respondió (`model`) y el costo cobrado (`usage.cost`), que es lo que
el presupuesto en dólares necesita medir.

**Tavily** en su plan gratuito: 1.000 créditos por mes sin tarjeta, una búsqueda
básica cuesta un crédito y devuelve el extracto de cada resultado, así que no hace
falta bajar páginas arbitrarias. Sus [términos](https://www.tavily.com/terms),
leídos el 2026-10-02, no prohíben conservar el resultado ni exigen atribución; sí
permiten a Tavily usar las consultas para entrenar (§9.2), y por eso una consulta
lleva sólo el nombre de la empresa y las industrias candidatas.

**Brave Search API se descartó** aunque era la preferencia inicial del owner. Desde
el 2026-02-12 ya no tiene plan gratuito (USD 5 de crédito mensual con tarjeta), y
sus [términos](https://api-dashboard.search.brave.com/terms-of-service) prohíben
almacenar resultados salvo de forma transitoria (§3(b)(i)), usarlos para evaluar
modelos (§3(b)(xiii)) y exigen el logo «POWERED BY BRAVE» (§4(d)). Los dos
primeros chocan con persistir la evidencia de una propuesta y con los evals de
`F5-07`.

Derechos, sobre el registro existente:

| Fuente       | Fila                                                           | Qué cubre                                                                                               |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sec-edgar`  | `aiTransfer`: `unknown` → `allowed`                            | la SEC autoriza copiar y redistribuir su contenido con cita: mandar un extracto a un modelo es copiarlo |
| `openrouter` | `approved_personal`, guardado de la respuesta `owner_accepted` | la propuesta estructurada y su motivo; nunca prompts con datos de otra fuente                           |
| `tavily`     | `approved_personal`, guardado normalizado `owner_accepted`     | el extracto citado de cada resultado usado como evidencia                                               |

Lo que viaja a un modelo es contenido de la SEC, resultados de Tavily y las
**claves** de las industrias candidatas (`software-system-and-application`), que
son identificadores del proyecto. Ningún valor de Damodaran, ningún precio de
Yahoo y nada de Comafi o Caja: sus filas siguen con `aiTransfer` `restricted` o
`unknown`, y el armado del prompt lo comprueba contra el registro.

## Decisión 3 — la puerta de salida acepta `POST` con credencial de la fuente

La ADR 0009 sólo admitía `GET`. Un modelo y un buscador se consultan con un `POST`
JSON y una clave. La puerta se extiende sin abrir una segunda:

- la entrada de la allowlist declara el método y, si corresponde, la credencial:
  qué variable de entorno la trae y en qué header va. **La credencial la agrega el
  egress**, no el llamador: un adaptador nunca ve la clave y no puede mandarla a
  otro host;
- un `POST` tiene techo de bytes para el cuerpo del pedido además del de la
  respuesta, y no sigue redirects (`maxRedirects: 0`);
- las fuentes nuevas se identifican con un User-Agent genérico del proyecto, no
  con `SEC_USER_AGENT`: el contacto que la SEC exige no tiene por qué llegarle a
  un modelo;
- hosts y paths exactos: `openrouter.ai` `/api/v1/chat/completions` y
  `api.tavily.com` `/search`. El modelo no tiene herramientas y no puede pedir una
  URL: lo que lee es lo que el proyecto le manda.

Cada fuente nueva lleva su tope diario de requests (ADR 0020): `openrouter` 100
—las 16 ambiguas de la muestra con los tres escalones y una repetición con
búsqueda son 96 en el peor caso— y `tavily` 10, el techo candidato de la matriz
de uso, un tercio de lo que el plan gratuito da por día.

## Decisión 4 — un presupuesto en dólares, además del de requests

Contar requests no acota el gasto de un modelo: una llamada puede costar diez
veces otra. Se agrega un libro de gasto en PostgreSQL con las mismas reglas que
el contador de la ADR 0020:

- **antes** de cada llamada se reserva su peor caso —tokens del prompt más
  `max_tokens` de salida, al precio máximo aceptado para ese modelo— contra un
  tope por tarea y un tope diario. Si no entra, la llamada no sale y la tarea se
  abstiene con `ai_budget_exhausted`;
- **después**, la reserva se liquida con el `usage.cost` que informa OpenRouter;
- topes iniciales: USD 0,10 por tarea y USD 1,00 por día UTC, declarados en
  código; un control guardado sólo puede bajarlos, como en la ADR 0020;
- un **breaker** abre tras tres fallas de transporte seguidas del proveedor y
  frena la corrida, y el kill switch de la ADR 0020 vale para las dos fuentes
  nuevas;
- se recomienda además un límite de crédito sobre la clave en la cuenta de
  OpenRouter, como último cinturón fuera del proyecto.

Medido sobre los precios ZDR del 2026-10-02, una resolución con ~25.000 tokens de
entrada cuesta entre USD 0,001 y USD 0,05 según el escalón que la conteste.

## Decisión 5 — una escalera declarada de modelos baratos

El owner pidió que un motor vaya probando modelos baratos y eficientes para todo
lo que necesite IA. La escalera es código, versionada (`ai-model-ladder-1.0.0`)
y común a todas las tareas:

| Escalón | Modelo                         | Precio máximo aceptado (USD por millón, entrada/salida) |
| ------: | ------------------------------ | ------------------------------------------------------- |
|       1 | `deepseek/deepseek-v4.1-flash` | 0,60 / 2,40                                             |
|       2 | `openai/gpt-5.6-luna`          | 0,25 / 1,50                                             |
|       3 | `google/gemini-3.8-flash`      | 1,35 / 6,75                                             |

Tres familias distintas a propósito: una falla propia de una familia sube a otra.
Cada request fija `zdr: true`, `data_collection: "deny"`,
`require_parameters: true`, `max_price` del escalón y salida con JSON Schema
estricto; ninguno de esos valores se puede relajar por variable de entorno. Las
variables `OPENROUTER_MODEL_*`, `OPENROUTER_ENFORCE_ZDR`,
`OPENROUTER_DATA_COLLECTION` y `OPENROUTER_PROVIDER_ALLOWLIST` del `.env.example`
se eliminan: sólo queda la clave.

Una tarea empieza en el escalón 1 y sube al siguiente cuando la respuesta:

- no llega (error de transporte, `429`, `5xx`, timeout);
- no valida contra el schema;
- es rechazada por la policy de la tarea;
- es una abstención: un modelo más capaz puede encontrar lo que uno barato no vio.

La primera respuesta aceptada termina la tarea. Si el último escalón se abstiene,
la tarea se abstiene. Cada intento queda registrado con el modelo pedido, el que
respondió, tokens, costo, latencia y el motivo de escalar. Cambiar un modelo o un
precio es un diff revisable que sube la versión de la escalera; los evals de
`F5-07` son los que deciden si un cambio mejora.

## Decisión 6 — la tarea `industry-resolution-1.0.0`

Una tarea declara su versión, el schema de entrada, la versión del prompt, el
schema de salida y una policy determinista. La primera:

**Cuándo corre.** Sólo para una empresa cuyo mapeo da `ambiguous` y que no tiene
declaración del owner. Un SIC sin fila (`unmapped`) queda fuera: ahí la respuesta
no sería cerrada.

**Evidencia, en orden.**

1. **El último 10-K conocido al corte**, de la SEC: el Item 1 (Business) y la nota
   de segmentos, extraídos del documento principal de la presentación por una
   regla versionada. Se manda el texto dirigido, recortado a un techo de tokens,
   nunca el documento entero.
2. **Tavily**, sólo si el 10-K no alcanzó: la tarea se repite una vez con hasta
   cinco resultados agregados. Es el último recurso, no el primero.

Cada extracto entra con un ID de evidencia, delimitado y marcado como contenido
no confiable: puede traer instrucciones, y el prompt dice que no se obedecen.

**Salida.** `{ decision: "resolved", industryKey, evidenceIds, rationale }` o
`{ decision: "abstain", reason, evidenceIds }`, con `confidence`
`high | medium | low` ordinal como en la ADR 0031. `rationale` es texto para leer
y nunca entra a un cálculo.

**Policy, determinista.** Rechaza la respuesta si:

- `industryKey` no es una de las candidatas del SIC;
- la industria no existe en la release de betas visible al corte;
- no cita evidencia, o cita un ID que no estaba en la entrada;
- la confianza es `low`: una resolución de confianza baja vale como abstención.

## Decisión 7 — la respuesta es una aserción persistida y tiene precedencia propia

Una resolución aceptada se guarda con sus intentos, su evidencia —el extracto
con su hash, el accession o la URL de donde salió— y su costo, y se publica como
aserción en `classification_assignments`, con la taxonomía `damodaran-industry` y
la versión de la tarea. Su `available_at` es el instante en que se resolvió: una
consulta anterior no la ve, igual que el SIC observado de la ADR 0031.

- **Precedencia**: declaración del owner, después la resolución de la IA, después
  el SIC. El owner puede corregir a la IA en cualquier momento con una
  declaración, y la evaluación dice cuál de las tres decidió (`basis`).
- **Replay sin red.** Valuar o evaluar otra vez lee la aserción guardada; nunca
  vuelve a llamar al modelo. Una nueva resolución se pide a mano —por ejemplo,
  con un 10-K nuevo— y supersede a la anterior sin borrarla.
- **Rigor.** Una industria resuelta por la IA cuenta como mapeada en la
  completitud y lo declara: la superficie muestra «resuelta por IA», el modelo y
  las citas, distinto de «declarada por el owner».
- **Abstención.** Queda registrada con su motivo, y la empresa sigue `ambiguous`
  y nombrada, como hoy.

## Decisión 8 — hand-run, como el resto

```bash
pnpm valuation:resolve-industry --ticker AAPL           # resuelve y reporta, no escribe (sí gasta)
pnpm valuation:resolve-industry --ticker AAPL --apply   # también persiste la resolución
```

Un dry run llama al modelo y gasta, como cualquier dry run de este proyecto gasta
cuota. Sólo en modo `personal`; la clave nunca llega al navegador. No hay
superficie nueva: la evaluación existente la muestra.

## Incrementos

1. **Controles antes de la primera llamada** (`F5-01`, `F5-02`): `POST` con
   credencial en el egress, las dos fuentes en el registro y la allowlist, libro
   de gasto con topes y breaker, la escalera con dobles de test y una llamada real
   de humo medida.
2. **La tarea con evidencia de la SEC** (`F5-03`, `F5-06` para este caso):
   extracción de secciones del 10-K, prompt, policy, persistencia (migración),
   comando e integración con `valuation:assess`. Se mide sobre las 16 ambiguas de
   la muestra.
3. **Tavily como segunda evidencia** (`F5-04`).

## Consecuencias

- La IA entra al producto por el caso más acotado que tiene, y deja la escalera,
  el libro de gasto y la persistencia de propuestas listos para el mix
  geográfico, el carácter cíclico y los supuestos.
- Una industria puede quedar decidida por un modelo. Se acepta porque la
  respuesta es cerrada, está citada, la policy es determinista, el owner puede
  pisarla y queda a la vista.
- El gasto de la capa IA tiene techo en código, en la base y en la cuenta del
  proveedor.
- La revisión de derechos de `openrouter` y `tavily` vence el 2027-04-01.
