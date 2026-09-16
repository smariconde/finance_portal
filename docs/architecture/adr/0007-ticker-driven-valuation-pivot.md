# ADR 0007: valuación por ticker como espina del producto

- Estado: aceptado
- Fecha: 2026-09-04
- Alcance: reordena el [roadmap](../../finance-portal-masterplan/06_PHASED_ROADMAP.md)
  y enmienda la postura de derechos de la [ADR 0004](0004-personal-first-runtime.md)
- Decisiones relacionadas: [ADR 0003](0003-decimal-arithmetic-valuation-engine.md),
  [ADR 0005](0005-request-time-runtime-boundary.md) y
  [metodología de valuación](../../valuation/methodology.md)

## Contexto

El roadmap ordenaba el trabajo por capas de capacidad: identidad, ingesta,
comparación, valuación, arquetipos, macro argentina y recién al final IA. Bajo ese
orden, el producto entrega una valuación rigurosa de una empresa real al terminar
la Fase 5, con la capa de IA todavía dos fases más lejos y detrás del bloque de
Argentina y soja.

El owner declaró el objetivo real: **escribir un ticker y obtener un análisis
completo**, que se persiste para volver a verlo, que actualiza lo que cambió y que
sigue los cálculos y supuestos de Damodaran. La IA existe para decidir lo
cualitativo —tipo de empresa, riesgo, exposición— que modifica parámetros como la
tasa de descuento. El alcance inicial es el S&P 500.

Ese objetivo no cabe en el orden actual: lo que hoy está al final es lo que define
el producto, y lo que está al principio —screener, divergencias, CEDEAR histórico,
macro— es valioso pero no está en el camino crítico.

Hay además una restricción que el owner nombró como parte del producto, no como
excepción: **si un dato es difícil de conseguir, ese análisis no puede hacerse o no
puede ser igual de riguroso**. Hoy esa idea existe dispersa en `unsupported_method`,
en la distinción `missing` / `declared_absent` y en las quality flags, pero ninguna
capa la resuelve como una decisión explícita.

## Decisión

### 1. La espina del producto es la corrida por ticker

Todo lo demás es aguas abajo de esto. Una corrida toma un ticker, resuelve
identidad, arma el snapshot point-in-time, clasifica el arquetipo, determina qué
método es admisible con los datos que existen, propone los supuestos cualitativos,
los valida y ejecuta el motor determinista. El resultado se persiste y es
reproducible sin volver a consultar ninguna fuente.

### 2. La IA propone; el motor calcula

Esto ya era la intención de la metodología. Esta ADR lo vuelve una frontera
arquitectónica con nombre:

```text
fuentes      -> hechos numéricos            determinista, point-in-time
IA           -> propuesta cualitativa       no determinista, persistida con evidencia
policy       -> rango, coherencia, admisión determinista, puede rechazar
motor        -> la valuación                determinista, hasheada, replayable
```

Ningún número que entre al motor puede originarse en texto libre de un modelo. La
propuesta de la IA se persiste como parte del snapshot de entrada: un replay un año
después no vuelve a llamar al modelo y da idéntico resultado.

La IA decide, con evidencia citada y rango permitido, sólo lo que Damodaran trata
como juicio:

| Decisión cualitativa                      | Qué parámetro mueve                        |
| ----------------------------------------- | ------------------------------------------ |
| clasificación de industria                | beta desapalancada y margen objetivo       |
| mix geográfico de ingresos                | country risk premium por operaciones       |
| carácter cíclico y punto del ciclo        | normalización de margen y de precio        |
| one-offs que distorsionan earnings        | puente reported → normalized               |
| plausibilidad del guidance de crecimiento | crecimiento de los períodos explícitos     |
| señales de distress                       | probabilidad de fracaso                    |
| posición competitiva                      | velocidad de fade del ROIC y ROIC terminal |

Cada propuesta viaja como el `Assumption` que la metodología ya define, con
`sourceType: "ai_proposed"`, `evidenceIds`, `confidence` y `allowedRange`, y pasa
por el policy engine antes de tocar el motor.

### 3. Completitud de datos → admisibilidad → nivel de rigor declarado

Concepto de dominio de primera clase. Cada corrida declara con qué nivel de rigor
se hizo, y ese nivel es una salida visible, no una nota al pie:

| Nivel         | Requiere                                                                                                           | Resultado                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `full`        | ≥5 años de fundamentals, industria mapeada, mix geográfico, leases e I+D reconstruibles, deuda y cash desagregados | valor por acción con rango y sensibilidad          |
| `standard`    | ≥3 años, industria mapeada, sin mix geográfico confiable                                                           | CRP por domicilio legal, marcado como aproximación |
| `screening`   | sólo los últimos estados, sin reconstrucción de capital invertido                                                  | rango amplio, ROIC no confiable, sin terminal fino |
| `unsupported` | falta un input estructural del método                                                                              | no valúa; nombra qué falta y por qué               |

Degradar de nivel es un resultado legítimo y se registra. Lo que no se permite es
completar un faltante en silencio para poder mostrar un número.

### 4. Reordenamiento del roadmap

El orden pasa de capas de capacidad a **una empresa real valuada de punta a punta,
después las 500**. Nada se elimina: lo que sale del camino crítico conserva su fase
y sus criterios.

| Bloque                                                      | Estaba en        | Pasa a  |
| ----------------------------------------------------------- | ---------------- | ------- |
| Datos reales SEC + identidad del S&P 500                    | Fase 2 (parcial) | Fase 2  |
| Arquetipo, completitud y admisibilidad                      | Fase 5           | Fase 3  |
| Parámetros Damodaran y costo de capital bottom-up           | Fase 4 (`F4-05`) | Fase 3  |
| Extensiones del motor: leases, I+D, `g ≤ rf`, distress      | disperso         | Fase 4  |
| Capa IA bajo policy engine, con presupuesto y kill switch   | Fase 7           | Fase 5  |
| Corrida por ticker persistida, refrescable, y su superficie | disperso         | Fase 6  |
| CEDEAR como anotación de acceso: existe, ratio y precio     | Fase 2 (ingesta) | Fase 6  |
| Screener y catálogo de métricas                             | Fase 2           | Fase 7  |
| Divergencias fundamentales                                  | Fase 3           | Fase 8  |
| Argentina, BCRA, cambiario y soja Rosario/Chicago           | Fase 6           | Fase 9  |
| Persistencia personal, asistente y hardening                | Fases 8 y 9      | Fase 10 |

El orden anterior asumía que los arquetipos podían esperar. No pueden: el S&P 500
tiene del orden de 65 financieras y 30 REITs, y un FCFF industrial sobre esas
produce un número inválido. La elección del universo obliga al arquetipo.

### 5. La corrida es un job, no un request

Resolver identidad, traer filings, llamar al modelo y calcular no cabe en el ciclo
de vida de un request, y menos en una función serverless. La corrida se encola,
expone estado y persiste su resultado. La superficie lee el resultado persistido;
nunca dispara proveedores durante el render, que ya es regla de la ADR 0005.

Esta es la primera Route Handler o Server Action real del proyecto: activa `TM-03`,
que hasta hoy estaba `contracted` por no existir ninguna frontera.

### 6. Los derechos de fuente pasan de gate bloqueante a procedencia informativa

La aplicación es de uso personal del owner, no se vende ni se distribuye, y no
existe superficie anónima. El gate de derechos —`evaluateIngestionRights`
rechazando una corrida antes de llamar al proveedor— deja de bloquear.

Lo que **se conserva** es el registro de procedencia: qué fuente, qué documento, qué
fecha, qué parser. Eso no es una barrera legal, es el producto: una valuación sin
trazabilidad de dónde salió cada número no vale nada. Se conserva también la
prohibición de commitear secretos.

Consecuencia práctica: las golden fixtures dejan de ser sintéticas y pasan a ser
extractos reales congelados. Un test de regresión sobre `FixtureCo` no prueba que la
valuación de una empresa real siga siendo correcta.

## Consecuencias

- `TM-03` deja de estar `contracted` y necesita sus controles antes del primer
  endpoint.
- El despliegue remoto exige PostgreSQL hosteada; `DATABASE_URL` deja de apuntar al
  contenedor local. La separación pooled/direct de la ADR 0001 se mantiene.
- La clave del modelo vive server-side y nunca en `NEXT_PUBLIC_*`.
- El presupuesto por corrida, el kill switch y la observabilidad de costo llegan
  **junto con** la capa IA, no después. Esa parte del plan original era correcta.
- `F1-08` queda superado: mide la comprensión de una superficie construida sobre una
  fixture sintética que deja de ser el producto. La medición se rehace sobre la
  primera valuación real.
- Rigor y apariencia de consejo: una valuación con supuestos propuestos por un
  modelo se lee como una recomendación aunque no lo sea. El nivel de rigor declarado
  de la decisión 3 es la mitigación, y se diseña desde el principio.

## Alternativas descartadas

**Mantener el orden y llegar igual.** El resultado se posterga detrás de tres fases
que no lo requieren, y el motor sigue validándose contra datos inventados hasta el
final.

**Que la IA produzca la valuación completa.** Es el camino corto y destruye todo lo
que `F1-05` construyó: sin hash reproducible, sin replay, sin audit trail y sin
forma de saber si un cambio movió los números. Además Damodaran no es un estilo de
redacción, son fórmulas con precondiciones: se implementan o no se cumplen.

**Empezar por un universo más chico que el S&P 500.** Menos empresas no significa
menos trabajo: la cobertura de arquetipos es lo que dicta el esfuerzo, y el S&P 500
tiene datos densos y homogéneos vía XBRL.
