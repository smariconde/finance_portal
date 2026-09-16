# Estrategia de datos y trazabilidad

## Regla de oro

Un dato financiero no es solo un numero. Su identidad incluye concepto, entidad, periodo, fecha de presentacion, unidad, moneda, fuente, transformacion y fecha de descarga. Si alguno falta, el sistema baja su quality score o lo rechaza.

## Jerarquia de fuentes

| Dominio | Fuente primaria | Adaptador inicial | Fallback/validacion |
|---|---|---|---|
| Filings EE.UU. | SEC EDGAR | SEC submissions/companyfacts | filing HTML/XBRL |
| Universo CEDEAR | Caja de Valores | snapshot versionado | Comafi/BYMA/anuncios |
| Universo EE.UU. | snapshot S&P 500 PDDL + SEC mapping | import versionado y fechado | snapshot anterior/anuncios S&P; Nasdaq para identidad |
| Fundamentales normalizados | SEC EDGAR | mapping XBRL canonico | proveedor personal opcional/filing fuente |
| Precios EOD/historicos | Alpaca Basic en modo personal | bars multi-symbol, `1Day`, paginacion | segundo proveedor personal aprobado |
| Market cap historica | calculo propio | precio y shares point-in-time consistentes | valor de proveedor para control |
| BCRA | API oficial v4 | REST | catalogo/metodologia BCRA |
| Macro Argentina | datos.gob.ar/INDEC | API/descarga oficial | release original |
| FX referencia | BCRA/BNA | API/descarga | ninguna silenciosa |
| Soja Rosario | BCR/Camara Arbitral | descarga/parser | MAGyP historicos |
| Soja Chicago | feed con licencia | adapter configurable | ninguno no autorizado |
| Riesgo/sectores | NYU Stern/Damodaran | snapshot parser | FRED/Treasury para Rf |
| Evidencia cualitativa | documentos primarios | Tavily search/extract | filings/IR directos |

El proveedor sugerido puede cambiar luego de una prueba de cobertura, costo, rate limits, historico y licencia. La UI y el dominio no cambian.

## Gate de proveedor

Para una instancia personal el gate es deliberadamente liviano:

1. documentar que el plan permite uso personal/interno y que retencion/cache necesita la app;
2. registrar limites, atribucion, restricciones de exportacion y fecha de revision;
3. ejecutar un spike pequeno de cobertura/calidad/cuota;
4. aprobar adaptador, presupuesto y estrategia de salida mediante ADR;
5. si una URL anonima fuera a mostrar datos live, detenerse y abrir un gate nuevo de display/redistribucion.

Alpaca Basic es el candidato inicial para precios diarios personales por su historico, batching y limite publicado de 200 requests/minuto. FMP, Twelve Data y otros quedan como adaptadores alternativos, no dependencias simultaneas. Finviz se usa solo como contraste manual: su API oficial es Elite y sus datos no son la base automatizada.

## Registro de fuentes

Cada fuente necesita una entrada versionada con:

- owner y URL de documentacion;
- dataset/endpoints utilizados;
- autenticacion y rate limits;
- terminos, licencia y permiso de uso personal/cache; display/redistribucion solo si aplica;
- frecuencia esperada y freshness SLA;
- zona horaria, moneda y unidades;
- parser version y fixtures;
- fallback permitido;
- contacto/status page;
- fecha de ultima revision legal/tecnica.
- plan/contrato aplicable, fecha de vigencia, atribucion requerida y contacto que confirmo derechos;
- tratamiento permitido para raw, cache, datos derivados, CSV y exposicion a una IA.

No marcar `redistributable=true` por inferencia. El modo demo no reutiliza snapshots reales: usa fixtures creadas para el repositorio.

## Identidad y resolucion

Separar `legal_entity -> security/share_class -> listing -> depositary_program`. CIK identifica al filer, ISIN/FIGI al instrumento o clase segun el nivel, MIC/exchange al mercado y ticker a un simbolo con vigencia. Un CEDEAR puede apuntar a una accion, ADR o ETF: no asumir una relacion 1:1 por ticker.

La reconciliacion usa identificadores oficiales primero y OpenFIGI solo como ayuda secundaria. Guardar candidatos, score, reglas y decision manual. Cambios de ticker, mergers, spin-offs, delistings y ratios depositarios son eventos historicos, no updates destructivos.

## SEC

- Usar CIK como identidad, no ticker.
- Enviar User-Agent identificable y respetar Fair Access.
- Guardar `accession`, `filed`, `form`, `fy`, `fp`, `start`, `end`, `frame`, `unit` y taxonomy tag.
- Resolver tags alternativos con un mapping canonico versionado; conservar el tag original.
- Para puntos historicos evitar duplicados de filings posteriores y amendments sin perder lineage.
- Los bulk archives son preferibles para universo grande; las APIs por empresa sirven para refresh/detalle.
- SEC no entrega precios ni market cap historica: no forzar ese uso.
- Registrar `accepted`, `filed`, accession y taxonomy version como tiempo de conocimiento. Para una consulta historica no usar un amendment posterior salvo que el usuario elija vista restated.
- Validar una muestra con Arelle/EFM y reglas DQC vigentes como oraculo independiente; Zod valida forma, no semantica XBRL.

## Proveedor normalizado

El spike de Alpaca/SEC debe comenzar con 10 tickers CEDEAR representativos y crecer a 30 solo despues de pasar contratos y cuota. Comparar campos fundamentales con el filing fuente y evaluar:

- cobertura anual/trimestral/TTM de 5+ anos;
- EPS diluido, shares diluidas, market cap historica y corporate actions;
- moneda de reporte y conversion;
- sector/industria e identificadores;
- revisiones/restatements;
- batching, cuota, latencia y costo;
- uso personal, retencion y exportacion permitidos por el plan concreto;
- precision de identificadores y corporate actions;
- politica de revisiones, disponibilidad point-in-time y forma de representar delistings.

No construir el producto sobre datos gratis de Yahoo obtenidos por endpoints no contractuales.

## Presupuesto de cuota y persistencia

- Las paginas leen Postgres y muestran `as_of`/`fetched_at`; cero llamadas de proveedor por page view.
- Precios: un job EOD multi-symbol, en lotes paginados, con margen operativo del 50% respecto del limite por minuto documentado.
- SEC: los fundamentals se bajan para las empresas que el owner valua y para los filers de un sector con matriz de divergencia, nunca para todo el universo ([ADR 0016](../architecture/adr/0016-analysis-scope-sector-matrices.md)). `submissions` detecta filings nuevos y `companyfacts` se actualiza solo para entidades cambiadas de ese conjunto; ritmo objetivo maximo 2 requests/segundo aunque Fair Access admita mas.
- Backfills avanzan con cursor durable y presupuesto por corrida. Un `429` pausa sin borrar el ultimo snapshot valido.
- `provider_usage` registra requests, filas, paginas, ventana, respuesta y backoff. Un circuit breaker detiene la fuente antes de agotar el presupuesto configurado.
- Historicos ya obtenidos no se vuelven a pedir. Preferencias y valuaciones del owner tambien viven en Postgres; el navegador solo guarda estado de presentacion.

Para market cap usar `close * shares_outstanding` en la misma fecha y base de splits. Si SEC no ofrece shares comparables dentro de la ventana fiscal, el punto queda `null` o usa un valor de proveedor marcado; nunca se mezcla precio ajustado con shares sin ajustar.

## Vintages, transformaciones y reconciliacion

Cada observacion tiene tiempo efectivo y `available_at`. Guardar filing/publicacion, vintage, restatement, concepto original, transformacion/version y hash. Una transformacion es un nodo versionado: input IDs + formula + politica de redondeo + output. Esto permite reproducir un snapshot sin consultar nuevamente al proveedor.

El metric catalog define fuente preferida, precedencia, tolerancia absoluta/relativa y accion ante desacuerdo: `accept`, `flag`, `quarantine` o `manual_review`. El quality score tiene componentes visibles (completitud, freshness, comparabilidad, validacion y acuerdo); nunca es una cifra opaca producida por IA.

## Registro CEDEAR

Modelo minimo:

- `cedear_symbol`, `underlying_symbol`, `underlying_isin`, `cedear_isin`;
- `program_name`, `issuer`, `origin_exchange`, `country`;
- ratio como fraccion exacta `cedear_units / underlying_units`, no string solamente;
- alcance de inversor, tipo (share/ETF/corporate), sector publicado;
- `valid_from`, `valid_to`, fuente, hash del documento y fecha de ingesta.

Los ratios cambian. Nunca sobrescribir historia. La marca CEDEAR de las matrices sectoriales depende del snapshot vigente a la fecha consultada y se aplica a la security subyacente del programa, no a todas las clases del emisor.

## Catalogo de metricas y formulas

No hay screener general ([ADR 0016](../architecture/adr/0016-analysis-scope-sector-matrices.md)). El metric catalog contiene solo lo que usan las matrices sectoriales y la valuacion, cada entrada con nombre, formula, periodicidad, tratamiento de negativos y version. Ejemplos:

- `roic = nopat / average_invested_capital`;
- `fcf_yield = fcff_or_equity_fcf / corresponding_market_value` con definicion explicita;
- `net_debt_to_ebitda = (debt - excess_cash) / ebitda`;
- `share_count_cagr` sobre acciones diluidas promedio ajustadas.

No comparar ratios sin significado entre sectores. Por ejemplo, deuda/EBITDA no es el filtro central de un banco; mostrar metricas sectoriales o `not_applicable`.

## Matriz de riesgo sectorial: especificacion

Responde que empresas de un sector compensaron mejor su riesgo a la baja a 2 y a 5 anos, cuales superan al S&P 500 en las dos ventanas y a cuales se accede por CEDEAR. Solo usa precios ([ADR 0016](../architecture/adr/0016-analysis-scope-sector-matrices.md)).

1. Poblacion: las securities de los miembros del sector al `as_of`. El sector es una clasificacion versionada con taxonomia y vigencia, nunca una columna sin origen. Los que salieron del indice no aparecen, y la matriz declara ese sesgo de supervivencia.
2. Las ventanas de 2 y 5 anos terminan en el mismo cierre de mercado, que es el `as_of`. Precios y eventos se leen con su `available_at` y su base de ajuste declarada.
3. Para los `N` retornos por periodo de una ventana, con `mar` el retorno minimo aceptable del periodo y `k` los periodos por ano:
   - `excess_t = r_t - mar_t`
   - `downside_deviation = sqrt((1/N) * sum(min(0, excess_t)^2))`, sobre los `N` periodos y no solo los negativos
   - `sortino = mean(excess_t) / downside_deviation * sqrt(k)`
4. Casos que no producen numero:
   - historia menor que la ventana: `null` con `insufficient_history`, sin acortar la ventana;
   - `downside_deviation = 0`: `null` con `no_downside_observations`, nunca infinito;
   - huecos de precio por encima de la tolerancia documentada: `null` con `missing_period`, nunca retorno cero.
5. La referencia S&P 500 usa la misma base de retorno, frecuencia y ventanas que las empresas.
6. La recta de ajuste se calcula sobre los puntos del sector, sin la referencia, y publica su `n`. Como la ventana de 5 anos contiene a la de 2, parte de la correlacion entre ejes es mecanica.
7. Dos clases del mismo emisor son dos securities y dos puntos.

Parametros a decidir con el owner antes de escribir `sortino-1.0.0`:

| Parametro | Opciones | Recomendacion inicial |
|---|---|---|
| `mar` | cero o tasa libre de riesgo del periodo | a decidir |
| Frecuencia | diaria (`k = 252`) o mensual (`k = 12`) | a decidir; la mensual guarda unas 60 filas por security |
| Base de retorno | dividendos reinvertidos o solo precio | dividendos reinvertidos: solo precio castiga a quien paga dividendos altos |
| Referencia | indice de precio, indice total return o ETF ajustado | la que coincida con la base de retorno |
| Numerador | media aritmetica o CAGR | media aritmetica, la definicion estandar |
| Limites de ventana | calendario o cantidad de ruedas | a decidir |
| Clases del mismo emisor | todas o una por emisor | todas, con etiquetas legibles |

Los precios se guardan en una tabla propia y liviana, no en `observations`: unas 630.000 barras diarias de 5 anos para el universo ocuparian ~600 MB alli, contra un orden de 60-80 MB en una tabla liviana. El tamano se mide con un prototipo antes de ingerir.

## Divergencias fundamentales: especificacion exacta

La poblacion es un sector ([ADR 0016](../architecture/adr/0016-analysis-scope-sector-matrices.md)). Los fundamentals que necesita —EPS diluido, net income y acciones diluidas en los dos cierres de cada horizonte— se bajan de la SEC para los filers de ese sector, con la ventana de cinco ejercicios; no hay carga de todo el universo.

Para horizonte `h`:

1. Seleccionar el ultimo cierre fiscal disponible y el cierre fiscal comparable mas cercano a `h` anos atras.
2. Exigir que la distancia real este dentro de una tolerancia documentada; usar `years = days / 365.2425`.
3. Market cap debe corresponder a la fecha fiscal o al ultimo dia de mercado cercano, con ventana maxima.
4. EPS es diluted EPS de operaciones continuas cuando pueda normalizarse; mostrar GAAP reportado como control. El precio es ajustado por splits de forma consistente con EPS/shares, pero no total-return ajustado por dividendos.
5. Calcular cada vista solo cuando sus dos extremos de beneficios y valor de mercado sean estrictamente positivos; una vista puede ser valida aunque la otra no:
   - `market_cap_cagr_pct = ((mc1 / mc0)^(1/years)-1)*100`
   - `net_income_cagr_pct = ((ni1 / ni0)^(1/years)-1)*100`
   - `aggregate_gap_pp = net_income_cagr_pct - market_cap_cagr_pct`
   - `price_cagr_pct = ((price1 / price0)^(1/years)-1)*100`
   - `eps_cagr_pct = ((eps1 / eps0)^(1/years)-1)*100`
   - `per_share_gap_pp = eps_cagr_pct - price_cagr_pct`
   - conservar `fundamental_gap_pp = eps_cagr_pct - market_cap_cagr_pct` solo como diagnostico historico, no ranking aislado.
6. EPS o net income no positivo produce categoria especial por vista, no CAGR artificial.
7. Calcular `diluted_shares_cagr_pct`, reconciliar basic/diluted shares con corporate actions y explicar la diferencia entre las vistas.

Interpretacion: `aggregate_gap_pp` aproxima compresion/expansion entre beneficio total y equity value; `per_share_gap_pp` hace lo propio entre EPS y precio. Ninguna prueba infravaloracion: recompras, dilucion, picos ciclicos, riesgo, one-offs y expectativas requieren el puente explicativo.

## Argentina

### Series iniciales

- BCRA Estadisticas Monetarias v4 y catalogo vigente: reservas, base, M2, depositos, prestamos, tasas, CER/UVA, inflacion publicada y REM cuando esten disponibles. No usar endpoints de Principales Variables deprecados.
- Datos/INDEC: EMAE, salarios, IPC, PIB, industria/construccion, exportaciones, importaciones y saldo comercial.
- Cambiario: oficial mayorista/minorista de fuente oficial; MEP/CCL solo con feed licenciado y metodologia visible.
- Fiscal: resultado primario y financiero, montos y ratios sobre PIB con denominadores compatibles.
- Competitividad: ITCRM y series rebased sin presentar el indice rebaseado como nivel oficial.

El catalogo macro agrega frecuencia, unidad, nominal/real, ajuste estacional, base del indice, timezone, calendario de publicacion, lag, politica de revision, quiebres metodologicos y transformaciones permitidas. Guardar vintages cuando la fuente revisa historia y anotar cambios de regimen; una serie desestacionalizada no reemplaza silenciosamente a la original.

### Soja

- Rosario: precio pizarra ARS/t y, si se calcula USD/t, usar FX BNA comprador de la misma fecha o mostrar el descalce.
- Chicago: precio y contrato/fuente identificados. Conversion, si parte de USD/bushel: `USD_per_metric_ton = USD_per_bushel * 36.7437`.
- Definir `basis_pct = (rosario_usd_t / chicago_usd_t - 1) * 100`; negativo es descuento Rosario.
- Si se usa futuro continuo, guardar contrato y politica de roll. Los saltos de roll no son movimiento economico spot.
- Mostrar correlacion, percentil, mediana, bandas robustas y outliers; no convertir percentil en orden de compra/venta.

## Calidad y fallbacks

Flags sugeridos:

- `stale`, `estimated`, `restated`, `currency_converted`, `unit_converted`;
- `fiscal_alignment_approximate`, `missing_period`, `provider_disagreement`;
- `non_comparable`, `negative_denominator`, `outlier`, `parser_schema_changed`;
- `license_restricted`, `fallback_source`.

Un fallback se muestra como fallback. Un dato faltante es `null` con razon; nunca cero.
