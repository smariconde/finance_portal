# ADR 0016: alcance analítico — valuaciones puntuales y matrices sectoriales

- Estado: aceptado
- Fecha: 2026-09-16
- Alcance: enmienda el alcance de producto de la
  [ADR 0007](0007-ticker-driven-valuation-pivot.md) y de
  [`01_PRODUCT_AND_SCOPE.md`](../../finance-portal-masterplan/01_PRODUCT_AND_SCOPE.md).
  Redefine la Fase 7, acota las Fases 6 y 8 y cambia el objetivo del backfill de
  `F2-05`. No cambia el orden de las fases.
- Decisiones relacionadas: [ADR 0010](0010-sec-xbrl-ingestion.md) (qué se ingiere
  de la SEC), [ADR 0015](0015-durable-ingestion-jobs.md) (jobs durables),
  [matriz de uso de proveedores](../../data/provider-use-matrix.md)

## Contexto

El backfill del universo midió 1,2 GB para 501 filers (`F2-05`, incremento 1). El
owner preguntó por qué hacía falta guardar todo eso, dado que la base personal
pasa a un PostgreSQL hosteado en `F6-06` y el presupuesto es cero.

El alcance vigente justificaba ese volumen con dos piezas:

- un **screener general**, el módulo «Empresas y ratios», con un constructor de
  filtros y unos trece ratios fundamentales sobre todo el universo;
- una **valuación por lote** del universo (`F6-05`).

Las dos necesitan los fundamentals de las 500 empresas.

El 2026-09-16 el owner aclaró el alcance:

- **Screening general:** lo hace con la versión gratuita de Finviz. El portal no
  tiene que replicarlo.
- **Valuación:** es puntual. Se aplica a las empresas que le interesan, que
  elige escribiendo el ticker.
- **Comparaciones:** se hacen por sector y con matrices de dispersión. La primera
  compara el ratio de Sortino a 2 y a 5 años, distingue las empresas con CEDEAR y
  se calcula sólo con precios. La segunda compara el crecimiento del valor de
  mercado con el del EPS.
- **Propósito del portal:** cálculos y análisis específicos que un screener
  general no ofrece.

## Decisión

### 1. Dos clases de análisis con necesidades de datos distintas

| Análisis              | Población                                 | Datos                                                                                                          | Cuándo se bajan                                                    |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Valuación             | las empresas que el owner pide por ticker | fundamentals completos de la ventana: los 58 conceptos, cinco ejercicios                                       | al pedir el ticker, una vez, como job; después, refresh de ese CIK |
| Matriz de riesgo      | un sector del S&P 500 y su referencia     | precios diarios                                                                                                | job de precios fuera del request                                   |
| Matriz de divergencia | un sector del S&P 500                     | precios y una tajada fina de fundamentals: EPS diluido, net income y acciones diluidas en dos cierres fiscales | job por sector, fuera del request                                  |

Una página nunca llama a un proveedor: lee lo que un job dejó en PostgreSQL.

### 2. El screener general queda fuera de alcance

Quedan fuera:

- el constructor de filtros AND/OR y sus presets;
- los ratios fundamentales sobre todo el universo;
- la tabla con columnas a elección.

Para eso está Finviz, de uso manual. Finviz no es una fuente del portal: el
masterplan ya lo limitaba a contraste manual.

El catálogo de métricas sigue existiendo, pero sólo con lo que usan las matrices y
la valuación.

### 3. Los fundamentals no se cargan para todo el universo

- El backfill del universo deja de ser un objetivo de producto.
- La maquinaria de la ADR 0015 se conserva: un job es un plan de CIK, y el plan
  pasa a ser el de un ticker o el de un sector (`--cik` ya lo acota).
- La ventana de cinco ejercicios (`F2-05`, incremento 2) sigue siendo necesaria:
  gobierna también la ingesta por ticker.
- `F6-05` deja de ser la valuación por lote y pasa a ser la **ingesta bajo
  demanda**: si la empresa pedida no tiene la ventana, la corrida la baja con
  presupuesto y reanudación.
- El refresh de CIK cambiados (`F2-05`, incremento 4) recorre sólo el conjunto
  seguido: las empresas valuadas y los sectores con matriz.
- El universo constituido se conserva. Define la población de cada sector y
  resuelve tickers, y ocupa unos 24 MB.

### 4. Matriz de riesgo sectorial: Sortino a 2 y a 5 años

**Pregunta:** en este sector, ¿qué empresas compensaron mejor su riesgo a la baja
a 2 y a 5 años, cuáles superan al S&P 500 en las dos ventanas y a cuáles se accede
por CEDEAR?

Lo que fija esta ADR:

- **Ejes.** X es el Sortino a 2 años e Y el Sortino a 5 años. Las dos ventanas
  terminan en el mismo cierre de mercado, que es el `as_of` de la matriz.
- **Referencia.** El S&P 500 es un punto propio y además el cruce de dos líneas que
  dividen los cuadrantes. Arriba a la derecha quedan las empresas que superaron a
  la referencia en las dos ventanas.
- **Misma base.** La referencia se calcula con la misma base de retorno que las
  empresas. Un índice de precio no se compara contra acciones con dividendos
  reinvertidos.
- **Un punto por security, no por emisor.** GOOG y GOOGL, FOX y FOXA, NWS y NWSA
  son instrumentos distintos (modelo de identidad). Sus etiquetas no pueden
  superponerse: en el ejemplo del owner, GOOG y GOOGL se tapan.
- **CEDEAR.** Sale del programa depositario vigente al `as_of`, que apunta a una
  security concreta. Si un emisor tiene dos clases, sólo la subyacente lleva la
  marca. La marca combina forma o borde con color; el color solo no alcanza.
- **Recta de ajuste.**
  - Se nombra como ajuste lineal de los puntos del sector, con su `n` y sin la
    referencia. No es una línea de valor justo.
  - La ventana de 5 años contiene a la de 2, así que la correlación entre los ejes
    es en parte mecánica.
  - La lectura útil es la distancia a la referencia y a la recta, no la pendiente.
- **Población.** Son los miembros del sector al `as_of`. Hay sesgo de
  supervivencia, porque los que salieron del índice no aparecen, y la matriz lo
  declara.
- **Faltantes.**
  - Una security sin cinco años de historia tiene Y `null` con motivo
    `insufficient_history`. No se calcula con una ventana más corta.
  - Sin ningún retorno por debajo del mínimo aceptable, el ratio es `null` con
    motivo `no_downside_observations`, nunca infinito.
  - Un hueco de precios no se rellena con retorno cero.
- **Tabla equivalente.** La matriz tiene una tabla con los valores crudos,
  incluidos los que un recorte de escala deje en el borde (META en el ejemplo) y
  los `null` con su motivo.

La fórmula se versiona (`sortino-1.0.0`) cuando se implemente. Sobre `N`
retornos por período de la ventana, con `mar` el retorno mínimo aceptable del
período y `k` los períodos por año:

```text
excess_t            = r_t - mar_t
downside_deviation  = sqrt( (1/N) * Σ min(0, excess_t)^2 )     sobre los N períodos
sortino             = mean(excess_t) / downside_deviation * sqrt(k)
```

Parámetros que se deciden con el owner en el slice de la fórmula, antes de
escribirla:

- **`mar`:** cero o la tasa libre de riesgo del período.
- **Frecuencia:** diaria (`k = 252`) o mensual (`k = 12`). La mensual necesita
  unas 60 filas por security en la ventana de 5 años.
- **Base de retorno:** con dividendos reinvertidos o sólo precio. Se recomienda la
  primera para una comparación de largo plazo: sólo precio castiga a las empresas
  que pagan dividendos altos, como T o VZ en el ejemplo.
- **Instrumento de referencia** coherente con esa base.
- **Numerador:** media aritmética, que es la definición estándar, o CAGR.
- **Límites de las ventanas:** por calendario o por cantidad de ruedas.
- **Clases de un mismo emisor:** si se muestran las dos o una sola por emisor.

### 5. Matriz de divergencia sectorial

Es la especificación de Fase 8 que ya existe en
[`03_DATA_AND_PROVENANCE.md`](../../finance-portal-masterplan/03_DATA_AND_PROVENANCE.md),
aplicada a un sector. Lo que esta ADR agrega:

- **Necesita fundamentals, aunque pocos:** EPS diluido, net income y acciones
  diluidas en los dos cierres fiscales de cada horizonte. La fuente es la SEC con
  la ventana de cinco ejercicios, y la ingesta se acota a los filers del sector.
- **Vistas.** La descripción del owner —crecimiento del valor de mercado contra
  crecimiento del EPS— es la vista `fundamental_gap_pp`. La especificación la
  conserva como diagnóstico y no como vista principal, porque compara un total
  con un valor por acción. En efecto,
  `(1 + mc_growth) / (1 + eps_growth) = (cambio del P/E) × (acciones_1 / acciones_0)`.
  Una empresa que recompra acciones aparece más barata de lo que se volvió su
  múltiplo, en la proporción exacta de las acciones recompradas.
- **Pares por defecto:** precio contra EPS, y valor de mercado contra net income.
  El puente de acciones explica la diferencia entre las dos vistas.
- **Pendiente con el owner:** confirmar cuál de las vistas se muestra primero.

### 6. Volumen objetivo: el plan gratuito

El objetivo es que la base hosteada entre en un plan gratuito, que al 2026-09-16
ofrece 0,5 GB en Neon Free y 500 MB en Supabase Free. Estimaciones preliminares,
que se miden sobre datos reales antes de cada ingesta:

| Pieza                                            | Estimación                                                     |
| ------------------------------------------------ | -------------------------------------------------------------- |
| Universo e identidad                             | ~24 MB, medido                                                 |
| Fundamentals por empresa valuada                 | ~0,5 MB con ventana y filas livianas; ~0,8 MB sólo con ventana |
| Tajada de divergencia de un sector de ~70 filers | hasta ~35 MB con la ingesta completa de la ventana             |
| Precios diarios, ~503 securities, 5 años         | ~630.000 barras: del orden de 60–80 MB en una tabla liviana    |

Los precios **no** van a `observations`. Con unos 945 bytes por fila, los precios
diarios ocuparían unos 600 MB allí. La tabla de precios y su tamaño por fila se
deciden con un prototipo medido.

Sin poda, la ventana crece un ejercicio por año, así que antes de `F6-06` hay que
decidir qué se borra.

### 7. La fuente de precios sigue abierta

Los precios son un proveedor nuevo y entran con su propia ADR en `F7-01`. Los
candidatos registrados son dos:

- **Yahoo Finance:** el owner lo aprobó para uso personal el 2026-08-25, en la
  matriz de uso. El masterplan advierte contra depender de endpoints no
  contractuales, y la ADR de precios tiene que resolver esa tensión.
- **Alpaca Basic:** está en `blocked_rights` para persistir barras.

Esta ADR no elige ninguno de los dos.

## Consecuencias

- **Documentos actualizados:**
  - `01_PRODUCT_AND_SCOPE.md`, `03_DATA_AND_PROVENANCE.md`, `05_UX_UI.md` y
    `06_PHASED_ROADMAP.md`;
  - [`prd.md`](../../product/prd.md), `PRODUCT.md` y el
    [backlog](../../backlog/README.md).
- **Fase 7:** pasa de «Screener y catálogo de métricas» a «Matrices sectoriales de
  riesgo». Contiene precios, sector versionado, catálogo acotado, fórmula de
  Sortino, matriz, export y degradación.
- **`F6-05`:** pasa a ser la ingesta bajo demanda. Conserva sus controles
  (`TM-10`, `TM-11`, `TM-16`).
- **`F8-01`:** se acota a los filers del sector elegido.
- **ADR de la ventana:** la que el backlog numeraba como 0016 pasa a ser la
  **ADR 0017**.
- **Orden de las fases:** no cambia. Las matrices de riesgo no dependen del motor
  de valuación, y adelantarlas es una decisión del owner que esta ADR deja
  abierta.

## Alternativas descartadas

- **Screener general propio.** Duplica lo que Finviz ya da gratis. Exigiría los
  fundamentals del universo (de 250 MB a 1,2 GB) y un catálogo amplio de ratios
  con sus reglas sectoriales.
- **Consultar la SEC al abrir una página.** Una empresa tarda unos 4,4 s y hasta 66
  requests. Rompe el presupuesto cero por page view y la reproducibilidad de una
  corrida.
- **APIs gratuitas de terceros para fundamentals.** Tienen cuotas diarias chicas,
  no publican el instante de disponibilidad, pisan las re-expresiones y sus
  términos suelen prohibir guardar.
- **Guardar los precios en `observations`.** Serían unos 600 MB para los precios
  diarios del universo.
