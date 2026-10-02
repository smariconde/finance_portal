# ADR 0031: evaluación a demanda de la empresa que se analiza

- Estado: aceptado
- Fecha: 2026-10-02
- Alcance: `F3-01` y el gate de la Fase 3. Decide sobre qué empresas se verifica
  el gate, de dónde salen las señales de arquetipo, cómo se ordenan y cómo se
  fecha el SIC de la SEC.
- Decisiones relacionadas: [ADR 0016](0016-analysis-scope-sector-matrices.md)
  (los fundamentals se bajan por ticker elegido), [ADR 0017](0017-sec-history-window.md)
  (ventana y ancla del ejercicio), [ADR 0011](0011-issuer-succession-reporting-lineage.md)
  (linaje de reporte), [ADR 0025](0025-declared-sector-classification.md)
  (clasificación como aserción fechada), [ADR 0027](0027-cedear-registry-sources.md)
  (disponibilidad igual a la observación)

## Contexto

El gate de la Fase 3 decía: «cada empresa del universo recibe arquetipo y nivel
de rigor, o un `unsupported_method` con el input que falta nombrado». Leído al pie
de la letra, exige fundamentals de las quinientas empresas. La ADR 0016 sacó el
backfill del universo de los objetivos de producto, y la réplica midió 245 MB y
varios días de cuota diaria de la SEC.

El owner lo resolvió el 2026-10-02 con una pregunta: «¿esto no puede ser a demanda
de la empresa a analizar?». Sí puede, y es lo coherente: el portal valúa empresas
elegidas, y el arquetipo es la primera pregunta de esa valuación, no un atributo
que haya que precalcular para todas.

El mismo día eligió **umbrales versionados con fuente citada** para los arquetipos
no financieros, medidos contra la muestra declarada del gate.

## Decisión 1 — el gate es a demanda

Una empresa recibe arquetipo, rigor y costo de capital **cuando se la evalúa**:
`pnpm valuation:assess --ticker …`. El gate se cumple si **toda empresa evaluada**
sale con un perfil o con `unsupported_method` y el input que falta nombrado, y se
verifica sobre la muestra declarada del gate (`F2-07`), que cubre los diez
arquetipos.

No se constituye nada para el universo. Una empresa sin fundamentals ingeridos no
es un error: la evaluación lo nombra (`annual_fundamentals`) y el camino es
`pnpm fundamentals:ingest --ticker … --apply`.

## Decisión 2 — el SIC es una aserción fechada en su observación

El SIC sale de `submissions`, el mismo request que el sondeo del refresh, y se
guarda en `classification_assignments` con taxonomía `sec-sic`
(`sec-sic-classification-1.0.0`). No hay migración: la tabla es agnóstica de
taxonomía por diseño (ADR 0025).

La SEC publica el código vigente sin fecha de inicio. Por eso `validFrom` y
`availableAt` son la descarga, como en el registro CEDEAR: un corte anterior a la
primera captura no ve ningún SIC y se abstiene. Un cambio de código supersede en
la nueva observación; nunca cierra en una fecha que la fuente no publicó.

## Decisión 3 — precedencia estricta y madurez residual

`method-selection-0.2.0` ordena los perfiles: banco, aseguradora o REIT; holding;
distress; commodity; ciclo; pérdidas persistentes; alto crecimiento. Gana la señal
positiva de mayor precedencia y las que ceden quedan como alternativas. Sólo los
tres financieros comparten nivel: banco y REIT a la vez siguen siendo
`conflicting_evidence`.

Una señal positiva no alcanza si un perfil que la precede quedó **sin
evidencia**: podría ser él el que corresponde. `non_financial_mature` deja de ser
una señal y pasa a ser el residuo: se elige cuando todo lo demás tiene evidencia
negativa explícita.

## Decisión 4 — de dónde sale cada señal

| Regla                               | Perfiles                                            | Base                                                                                                                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sec-sic-profile-2.0.0`             | banco, aseguradora, REIT, holding, commodity, ciclo | Códigos de la lista SIC oficial de la SEC. Un SIC fuera de 6000–6799 descarta los cuatro financieros; uno dentro pero no mapeado no prueba nada. Holding no tiene regla positiva: la lista no publica el 6719.                                                       |
| `fundamental-profile-signals-1.0.0` | distress, pérdidas persistentes, alto crecimiento   | Cobertura de intereses bajo 1,25 dos años (borde `B-`/`CCC` de la tabla de rating sintético de Damodaran); EBIT negativo dos de tres años; ventas al 15 % anual compuesto en tres años. Los dos últimos son **decisiones del proyecto**, no cifras de la literatura. |

Cuando falta el dato principal, cada regla tiene alternativas declaradas: EBIT
reconstruido desde el resultado antes de impuestos más los intereses, resultado
neto positivo dos años, caja que cubre todo el pasivo. La salida las nombra y la
confianza las descuenta.

## Decisión 5 — confianza ordinal

`confidence` es `high`, `medium` o `low`, nunca un número: un 0,8 se lee como
probabilidad de acierto y nadie la midió. Baja un escalón si la decisión usó una
alternativa declarada y otro si otra señal cedió por precedencia.

## Consecuencias

- Medido sobre la muestra del gate el 2026-10-02: 30 SIC observados con 30
  requests; 21 de 29 empresas etiquetadas coinciden con el arquetipo declarado.
  Las 8 diferencias son de **tiempo**, no de regla: la etiqueta del owner describe
  un evento dentro de la ventana (el distress de 2020 de los cruceros, las
  pérdidas de Moderna) y el selector clasifica al corte. Ver la metodología.
- Una empresa con SIC de servicios financieros no mapeado (brokers, planes
  médicos) se abstiene siempre: no hay regla que la descarte como banco.
- Una evaluación histórica anterior a la primera captura del SIC se abstiene
  hasta que exista evidencia fechada antes de ese corte.
