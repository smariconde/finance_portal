# ADR 0034: riesgo país ponderado por operaciones, con el mix propuesto por la IA

- Estado: propuesto
- Fecha: 2026-10-16
- Alcance: `F5-05`, primer caso de supuestos —el mix geográfico de ingresos—, y la
  parte de `F5-06` que lo persiste. Decide de dónde salen los CRP regionales,
  cómo se lee un `.xlsx` sin dependencia nueva, qué propone la IA, qué comprueba
  la policy, cómo gana un lock del owner y cómo lo recalcula el motor.
- Decisiones relacionadas: [ADR 0007](0007-ticker-driven-valuation-pivot.md)
  (la IA propone, el motor calcula), [ADR 0031](0031-on-demand-company-assessment.md)
  (evaluación a demanda), [ADR 0032](0032-damodaran-reference-datasets.md)
  (datasets de Damodaran, que esta ADR enmienda para el riesgo país),
  [ADR 0033](0033-ai-layer-industry-resolution.md) (capa IA, escalera, gasto y
  primera tarea)

## Contexto

`cost-of-capital-1.0.0` suma a la ERP madura el CRP del país del listing
primario: para todo el S&P 500, el de Estados Unidos. Damodaran pondera el CRP
por **dónde opera** la empresa, no por dónde cotiza, y `completeness-profile-1.0.0`
lo nombra como faltante (`geographic_revenue_mix.not_ingested`): es lo que deja a
Apple y a Johnson & Johnson en rigor `standard`. `companyfacts` no trae
dimensiones, así que el mix no se puede ingerir: hay que leerlo del 10-K. Es una
fila de la tabla cualitativa de la [metodología](../../valuation/methodology.md)
—«mix geográfico de ingresos → country risk premium por operaciones»— y el owner
la eligió el 2026-10-15 como primer caso de `F5-05`.

Dos mediciones del 2026-10-15 y 16 dieron forma a la decisión:

- **Los filers publican por región, no por país.** Sobre el último 10-K de las 30
  empresas de la muestra del gate, sólo American Tower desagrega el 100 % de los
  ingresos por país; cinco lo hacen con un «Other» de hasta 10 % (NVDA, FCX, NEM,
  INCY, O); trece publican regiones o un resto grande («Americas», «Greater
  China», «EAME», «International», «All Other» de Ford con 19 %); las otras diez
  son domésticas o no traen tabla. Un mix sólo por país pondera de verdad 1 o 2
  de 30.
- **Los CRP regionales de Damodaran sólo están en Excel.** `ctryprem.html` trae
  únicamente países; el índice de datasets publica los regionales «as
  downloadable Excel». El mismo `.xlsx` (`ctrypremJuly26.xlsx`, 381 kB, 17
  hojas) trae «Regional Weighted Averages» —nueve regiones con CRP ponderado por
  PBI y el PBI de cada una— y «Regional breakdown» —157 países con rating,
  default spread, CRP, tasa corporativa, PBI y región—. Además el HTML refleja los
  números de enero de 2026 y el Excel ya va por julio: la página que ingerimos
  está seis meses atrás.

## Decisión 1 — el riesgo país se lee del `.xlsx` de Damodaran

`damodaran.country-risk` deja de leerse de `ctryprem.html` y pasa a leerse del
`.xlsx`, y se agrega `damodaran.country-risk-regions`. Las dos tablas salen **de
la misma descarga**, así que un CRP regional y uno de país nunca vienen de
releases distintas.

| Dataset                          | Hoja                         | Filas                                                                    |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `damodaran.country-risk`         | `Regional breakdown`         | país → rating, default spread, CRP, ERP, tasa corporativa, PBI y región  |
| `damodaran.country-risk-regions` | `Regional Weighted Averages` | las nueve filas resumen de región → default spread, ERP, CRP, tasa y PBI |

Los campos que lee hoy el costo de capital —`default_spread`,
`country_risk_premium`, `corporate_tax_rate`— conservan nombre y clave de fila:
la clave es el nombre normalizado igual que antes, con las entidades HTML
decodificadas (el Excel escribe `St. Vincent &amp; the Grenadines`). Las 22
filas del HTML sin rating —Rusia, Irán, Siria y otras, casi todas con CRP `NA`—
no están en la hoja y dejan de existir en la release nueva; una empresa que
opere ahí se resuelve por su región o no se pondera. También se pierde
`equity_risk_premium_cds`, que ningún cálculo lee; `moodys_rating` y
`sovereign_cds` siguen, con los encabezados del Excel.

El archivo cambia de nombre con cada actualización (`ctryprem.xlsx` en enero,
`ctrypremApr26.xlsx`, `ctrypremJuly26.xlsx`). El nombre vigente **se declara en
código**, como el pin del universo: cambiarlo es un diff revisable, y el runtime
nunca resuelve «el último» por su cuenta. La allowlist abre esa ruta exacta. Los
derechos son los de la ADR 0032: la misma fuente, `owner_accepted` para el acceso
automatizado, el archivo nunca se guarda y las fixtures son sintéticas.

La ERP implícita sigue siendo la de inicio de año (`histimpl.html`). Un CRP de
julio sobre una ERP de enero es lo que hace el propio Excel —su prima madura sale
de la ERP implícita de enero— y queda declarado en el costo de capital.

## Decisión 2 — un lector `.xlsx` propio, sin dependencia

Un `.xlsx` es un zip de XML. `node:zlib` ya trae `inflateRawSync` y `crc32`; lo
que falta es leer el directorio central y tres partes del XML.
`xlsx-sheet-reader-1.0.0` vive en `src/modules/reference-data/` y es deliberadamente
estrecho:

- **zip**: lee el directorio central, nunca recorre encabezados locales en
  busca de entradas; acepta sólo `stored` y `deflate`; rechaza ZIP64,
  cifrado, nombres con `..` o absolutos y entradas duplicadas; abre **sólo** las
  partes que necesita (`xl/workbook.xml`, sus relaciones, `xl/sharedStrings.xml`
  y las hojas declaradas). Cada parte tiene techo de tamaño declarado e inflado
  —4 MB por parte, 8 MB en total—, el inflado se corta en el techo y tiene que
  coincidir con el tamaño y el CRC32 del directorio;
- **XML**: rechaza `<!DOCTYPE` y `<!ENTITY`, decodifica sólo las cinco entidades
  predefinidas y las numéricas, y lee filas y celdas con un tokenizador lineal.
  Acepta celdas numéricas, de string compartido, `inlineStr` y `str` (resultado
  de fórmula); una celda de error (`t="e"`) es `null` con motivo;
- **números**: el texto de `<v>` se conserva tal cual y se parsea como decimal,
  nunca pasa por `number`. Lo que el Excel guarda es un double
  (`4.2000000000000003E-2`), y ese texto **es** el dato de la fuente: la release
  lo guarda sin redondear, y el costo de capital redondea donde ya redondeaba.

El parser de la tabla (`damodaran-xlsx-1.0.0`) verifica los encabezados de cada
hoja antes de leer una fila, exige las filas testigo (`United States`, `North
America`) y un mínimo de filas, y rechaza la descarga entera si una columna se
corre. Una región se reconoce como fila resumen —columna de región vacía y peso
total 1—, no por posición.

Se descarta agregar SheetJS o exceljs: parsean contenido externo con una
superficie mucho mayor que estas tres partes, y la ADR 0032 ya había elegido no
sumar una dependencia por un binario.

## Decisión 3 — la tarea `operations-mix-1.0.0`

La IA no propone pesos. **Transcribe** la tabla geográfica de ingresos del 10-K
y **mapea** cada línea a exposiciones de Damodaran; los pesos los calcula el
código.

Evidencia: `sec-10k-sections-1.1.0` agrega una tercera sección dirigida, la
tabla de ingresos por geografía, que puede estar en la nota de segmentos (Apple,
Ford), en la desagregación de ingresos (Salesforce, Norwegian, Moderna) o en una
nota de información geográfica (Incyte). Se mide sobre los 30 10-K de la muestra
**antes** de gastar en un modelo, como en `F5-03`. Al modelo viajan la sección
delimitada como no confiable, el nombre de la empresa y las claves candidatas
—los 157 países y las nueve regiones por nombre—. Ningún CRP, PBI ni otro valor
de Damodaran viaja: `aiTransfer` de esa fuente es `restricted`, y un nombre de
país no es contenido suyo.

Respuesta cerrada, o abstenerse:

- el ejercicio y la unidad declarada (`thousands`, `millions`, `billions`);
- cada línea: la etiqueta como la escribe el filing, el monto **como texto**, la
  cita (ID de evidencia y fragmento), y una o más claves de exposición con su
  base: `name_match` (la etiqueta nombra el país o la región),
  `filing_definition` (el filing define qué abarca: «North America includes the
  U.S., the Caribbean, Canada and Mexico», con cita) o `rest_of_world` (sólo para
  «Other», «Rest of world», «All other», «International», «Non-U.S.» y
  equivalentes);
- el total como texto, con su cita;
- confianza ordinal.

## Decisión 4 — la policy, determinista

`operations-mix-policy-1.0.0` rechaza la propuesta entera, nombrando el motivo,
si alguna de estas falla:

1. cada monto y el total aparecen **literalmente** en el fragmento citado, y el
   fragmento está en la evidencia enviada: ninguna cifra sale de texto libre;
2. la suma de las líneas coincide con el total (tolerancia de redondeo:
   0,5 %);
3. el total, en la unidad declarada, coincide con los ingresos anuales del mismo
   ejercicio de `annual-fundamentals-1.0.0` (tolerancia 2 %): atrapa la tabla
   equivocada —activos de largo plazo, primas, cartera— y la unidad equivocada;
4. el ejercicio coincide con el del 10-K;
5. toda clave existe en la release vigente al corte, y `name_match` se comprueba
   contra el nombre de la fila —país o región— normalizado o un alias declarado
   en código (`U.S.` → `united-states`);
6. `filing_definition` trae una cita que nombra lo que abarca la región;
7. `rest_of_world` se usa sólo en una línea cuya etiqueta es de resto;
8. confianza `low` es abstención, como en `industry-resolution-1.0.0`.

## Decisión 5 — la aritmética: pesos por ingresos, regiones por PBI

Con la propuesta aceptada, el código calcula:

- **peso de línea** = monto / total, en decimal exacto;
- **CRP de línea**: una sola clave toma el CRP de su fila; varias claves se
  combinan **ponderadas por el PBI de cada fila en la misma release**, que es
  como Damodaran construye sus propias regiones («Americas» → Norteamérica,
  Centro y Sudamérica y Caribe; «Greater China» → China, Hong Kong y Taiwán);
  `rest_of_world` es la combinación por PBI de las nueve regiones;
- **CRP por operaciones** = Σ peso × CRP de línea.

El costo de capital (`cost-of-capital-1.1.0`) usa ese CRP en lugar del del país
de cotización para la prima del equity, en el período y en el terminal. El
default spread y la tasa marginal siguen siendo del domicilio: la deuda la emite
la casa matriz. Cada componente entra como parámetro con su procedencia —dataset,
release, fila, campo— junto con los pesos, y el check
`wacc_built_from_components` recalcula el CRP ponderado desde el snapshot: un CRP
escrito a mano que no coincide se rechaza. Metodología `0.5.0`. La declaración
`country_risk_by_primary_listing` se reemplaza por `country_risk_by_operations`
cuando hay mix, y se suman `regions_combined_by_gdp` y
`rest_of_world_as_global` cuando se usaron.

Sin mix aceptado ni declarado, el costo de capital sigue exactamente como hoy,
con el CRP del domicilio: la falta de mix nunca es un CRP cero.

## Decisión 6 — el lock del owner gana siempre

`declared-operations-mixes.ts` (vacío al empezar) declara por CIK líneas con
claves y pesos como fracciones exactas que suman 1, con motivo escrito. Es el
lock de la metodología: con una declaración vigente **no se pregunta** al modelo
(`declared_by_owner`, sin gasto) y una propuesta guardada no se lee. Precedencia
owner → IA → domicilio, como la industria.

## Decisión 7 — persistida y sin repreguntar

Migración `0026`: `operations_mix_proposals` guarda toda respuesta —aceptada,
rechazada con motivo o abstención— con modelo, escalón, costo, 10-K
(`accession`), ejercicio y política; `operations_mix_lines` sus líneas y
`operations_mix_evidence` los extractos con hash, como `industry_resolutions`.
Una propuesta está disponible desde que se aceptó. La evaluación y la corrida
leen la aceptada más reciente al corte, para el 10-K visible a ese corte; no se
repregunta por el mismo 10-K salvo con `--again`. El replay lee lo guardado y
nunca llama al modelo.

```bash
pnpm valuation:operations-mix --ticker AAPL           # pregunta y reporta, no escribe (sí gasta)
pnpm valuation:operations-mix --ticker AAPL --apply   # también guarda la propuesta
```

`completeness-profile-1.1.0` da `geographic_revenue_mix` por presente cuando hay
mix declarado o aceptado al corte, y nombra el motivo cuando la propuesta se
rechazó.

## Incrementos

1. **Lector y datasets**: `xlsx-sheet-reader-1.0.0`, `damodaran-xlsx-1.0.0`, el
   pin del archivo, la allowlist y las dos releases; medido con
   `pnpm damodaran:record --apply`.
2. **Evidencia**: `sec-10k-sections-1.1.0` medido sobre los 30 10-K, sin modelo.
3. **La tarea**: `operations-mix-1.0.0`, la policy, la migración `0026`, el lock
   y el comando, medidos sobre la muestra.
4. **El motor**: `cost-of-capital-1.1.0`, el check que recalcula,
   `completeness-profile-1.1.0` y metodología `0.5.0`, con la muestra evaluada
   antes y después.

## Consecuencias

- El riesgo país pasa a ser el de julio en lugar del de enero, y con ello cambia
  el WACC de toda la muestra aunque no tenga mix; las corridas guardadas no se
  reescriben, porque citan su release.
- Una empresa con operaciones en un país sin rating queda resuelta por su
  región, o sin ponderar.
- El proyecto mantiene un lector de zip y de XML propio. Se acepta porque abre
  cuatro partes conocidas de un archivo declarado, con techos y CRC, y porque la
  alternativa era una dependencia con mucha más superficie.
- Combinar regiones por PBI y tratar el resto como el mundo son aproximaciones
  con nombre: quedan declaradas en la corrida y el owner las puede pisar con una
  declaración.
- `F5-07` mide la tasa de rechazo de la policy y la de abstención; si el
  escalón 1 sigue fallando el schema, se decide ahí.
