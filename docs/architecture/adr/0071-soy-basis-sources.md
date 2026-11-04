# ADR 0071: fuentes de la soja —pizarra de Rosario, BNA, Chicago y estimaciones agrícolas—

- Estado: aceptada
- Fecha: 2026-11-04
- Alcance: `F9-05`, después del contrato `soy-basis-1.0.0`.
- Relacionadas: [ADR 0026](0026-daily-prices-source.md) (Yahoo como
  `owner_accepted`), [ADR 0027](0027-cedear-registry-sources.md) (fuentes sin
  términos publicados), [ADR 0032](0032-damodaran-reference-datasets.md) (lector
  `.xlsx` propio), [ADR 0033](0033-ai-layer-industry-resolution.md) (`POST` en
  la puerta), [ADR 0069](0069-argentina-activity-fiscal-external.md) (registro de
  indicadores), [ADR 0070](0070-argentina-refresh-on-open.md) (actualización al
  abrir).

## Contexto

El basis de la soja compara la pizarra de Rosario, pasada a dólares, con
Chicago. El contrato puro ya existe (`soy-basis-1.0.0`): exige pizarra en ARS/t,
BNA divisas comprador y una cotización de Chicago con contrato y unidad
identificados, las tres del mismo día de mercado y conocidas al corte. Falta de
dónde salen, con qué derechos y cómo se guardan. El backlog pide además el
volumen de soja de las estimaciones agrícolas del Ministerio.

## Medición (2026-11-04)

Contra los cables reales, con `curl` al scratchpad y sin guardar nada en el
repositorio:

| Pierna          | Cable                                                               | Historia                                                 | Costo             | Términos                                                                                 |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Pizarra Rosario | `cac.bcr.com.ar/es/api/prices/987/export`, `.xlsx`                  | 6.551 días desde 2000-01-03; 676 `S/C`, 5.875 con precio | 1 request, 160 kB | Ninguno publicado; «Todos los derechos reservados»                                       |
| BNA divisas     | `bna.com.ar/Cotizador/DescargarPorFecha`, CSV                       | Compra y venta desde 2002-01-11                          | 1 request, 248 kB | «Solo para uso personal y privado se permite descargar»; prohíbe reproducir o transmitir |
| Chicago         | Yahoo `ZS=F`, `USX` (centavos/bushel)                               | 6.573 días desde 2000-09-15                              | 1 request, 338 kB | Yahoo ya es `owner_accepted` (ADR 0026)                                                  |
| Volumen         | `datosestimaciones.magyp.gob.ar`, `POST` de formulario, CSV latin-1 | Campañas 1969/70 a 2025/26, las cuatro variables         | 1 request, 3 kB   | El sitio no declara licencia                                                             |
| Conciliación    | `datos.magyp.gob.ar`, CSV anual                                     | Campañas 1941/42 a 2024/25                               | 1 request, 3 kB   | CC BY 4.0                                                                                |

Lo que no se ve en la tabla:

- **La pizarra publica el dólar con el que convierte.** La portada de la CAC
  dice que la conversión es informativa con «la cotización del dólar
  estadounidense divisa al cierre tipo comprador del BNA» y muestra la del día:
  1.542 el 2026-11-03, la misma que trae el CSV del BNA. Por eso la pierna
  cambiaria es el BNA y no la cotización del BCRA, que ya tiene derechos
  `allowed` pero no es la que usa el mercado de Rosario.
- **Las fechas de la CAC traen la hora de carga.** El serial de Excel es entero
  hasta 2010, con fracción de entre 0,10 y 0,50 día entre 2010 y 2020 (la hora
  de carga) y 0,125 desde 2020-12-18 (medianoche de Buenos Aires en UTC). El
  día es la parte entera en todos los casos: ninguna fracción llega a 0,875.
- **Los precios de la CAC son `double`.** 1.016 valores vienen como
  `176.099999999999994`. La pizarra cotiza en pesos con centavos.
- **El BNA no necesita sesión.** La página de descarga pone un token
  antiforgery, pero el `GET` responde igual sin token ni cookie: la puerta no
  cambia.
- **Yahoo conserva pocos contratos vencidos.** `ZSX25` y `ZSN25` responden,
  `ZSX24`, `ZSF26` o `ZSH26` dan 404. No hay con qué armar una serie continua
  propia hacia atrás.
- **`ZS=F` es deducible.** Es el contrato más cercano cuyo último día de
  negociación —el hábil anterior al día 15 del mes del contrato— todavía no
  pasó: 121 de 121 días verificables contra los contratos individuales
  disponibles (`ZSN25`, `ZSX25`, `ZSX26`) coinciden al cuarto de centavo. Rueda
  al vencimiento: el 2026-11-03 todavía era `ZSX26`, en su mes de entrega, con
  1.781 contratos contra ~60.000 una semana antes.
- **Las dos publicaciones del Ministerio concilian.** En 56 campañas comunes,
  superficies y producción difieren a lo sumo 2e-7 relativo (9 t en 2023/24);
  el rendimiento sólo por redondeo, porque Estimaciones imprime enteros y el CSV
  dos decimales (≤ 0,41 kg/ha).

## Decisión

1. **Cinco fuentes, cada una con su fila de allowlist, derechos y tope diario.**
   - `bcr-cac-pizarra` (`GET`, sólo el export de precios), `owner_accepted`.
   - `bna-fx` (`GET`, sólo `DescargarPorFecha`), `owner_accepted`.
   - `yahoo-finance`, la fila existente, con un dataset nuevo
     (`yahoo.futures-close`) y la moneda `USX`.
   - `magyp-estimaciones` (`POST` sin credencial, cuerpo de a lo sumo 4 kB, sin
     redirects), `owner_accepted`: el sitio no declara licencia.
   - `magyp-datos-abiertos` (`GET`, sólo el CSV anual de soja), `allowed` por
     CC BY 4.0.

   Decisión del owner del 2026-11-04 para las tres `owner_accepted`: el portal es
   personal, la descarga para uso personal es lo que el BNA admite y la CAC no
   publica condiciones. `rawStorage`, `publicDisplay`, `export` y `aiTransfer`
   quedan `restricted`.

2. **Siete series en el registro de indicadores de la ADR 0069, sin
   migración.** El contrato admite un bloque `agro`, la frecuencia `daily` y la
   moneda `physical` (hectáreas, toneladas, kg/ha); las tablas ya guardan
   cualquier fecha y la definición es `jsonb`. Se declaran aparte
   (`declared-soy-indicators.ts`) para que la lectura del tablero no arrastre
   veinte mil puntos diarios que no dibuja. Las series:
   pizarra de soja (ARS/t), BNA divisas comprador (ARS por USD), `ZS=F`
   (centavos de dólar por bushel) y, por campaña, superficie sembrada,
   superficie cosechada, producción y rendimiento de soja total. Heredan la
   revisión por punto con disponibilidad observada, la historia entera en cada
   corrida y la guarda de cambio masivo.

3. **Lectores cerrados por fuente.**
   - `bcr-cac-pizarra-1.0.0`: hoja `Worksheet` con título «Consulta de
     precios», producto «Soja» y encabezados «Fecha de operación» y «Precio»;
     el día es la parte entera del serial; `S/C` es un nulo de la fuente; un
     precio se lleva a centavos (`cac-peso-cents-1.0.0`) sólo si el `double`
     está a menos de una millonésima de ellos, y si no se rechaza por nombre.
   - `bna-divisas-1.0.0`: encabezado exacto, cada fila «Dolar U.S.A», fecha
     `d/m/aaaa`, coma decimal; un día repetido con otro valor se rechaza.
   - Chicago reusa el lector de Yahoo y `settled-session-1.0.0`: para un futuro
     Yahoo declara la sesión como el día entero, así que la barra del día entra
     recién con la descarga del día siguiente. El lector pasa a
     `yahoo-chart-1.3.0`, que fecha cada instante en la zona IANA del mercado
     (`exchangeTimezoneName`): `1.2.0` aplicaba a toda la serie el `gmtoffset`
     de hoy, y un futuro sella su rueda a la medianoche de Nueva York, así que
     cada rueda de horario de verano caía el día anterior —796 de 6.573 en
     domingo en la primera carga de la réplica—. Una acción sella a la apertura
     y su fecha no cambia; un job de precios planeado con `1.2.0` se replanea.
   - `magyp-estimaciones-1.0.0`: latin-1, encabezado exacto, cultivo «Soja
     total», campañas `aaaa/aa` consecutivas y números enteros. La campaña
     `aaaa/aa` se fecha el 1 de julio de `aaaa` (convención del proyecto).

4. **El contrato de Chicago se deduce y se nombra en cada punto.**
   `cbot-soy-front-contract-1.0.0` da, para cada día, el contrato (`ZSX26`) y
   si está en **período de entrega** —desde el first notice day, el último día
   hábil del mes anterior al del contrato, hasta su último día de negociación—.
   El basis se calcula igual en esos días y la superficie los marca (decisión
   del owner): excluirlos dejaría sin basis a un cuarto de los días hábiles.
   La regla no mira feriados; los últimos días de negociación de soja nunca caen
   en uno.

5. **Estimaciones se concilia en cada corrida.** `magyp-reconciliation-1.0.0`
   compara cada campaña común con el CSV CC BY: superficies y producción a lo
   sumo 1e-5 relativo, rendimiento a lo sumo 0,5 kg/ha. Una campaña que no
   concilia detiene la corrida por nombre (`reconciliation_failed`) antes de
   tocar lo guardado.

6. **La página la lee y la pone al día.** `/argentina` suma un bloque de
   soja (`argentina-dashboard-2.1.0`, `soy-block.ts`) leído al mismo corte que
   los otros: el basis de cada día de pizarra con las patas de ese mismo día
   —el que no las tiene dice cuál faltó—, cinco años día por día y la historia
   al cierre de mes, la última lectura con su contrato y su período de
   entrega, la fecha propia de cada pata y la producción por campaña. La
   actualización al abrir (ADR 0070) suma tres fuentes —pizarra y BNA diarias,
   Estimaciones una vez por día de Buenos Aires— y `ZS=F` entra como un sujeto
   más del job de Yahoo, que cuenta como revisión una corrida en
   `yahoo.futures-close` o en las patas del CCL (`recordedIn`). Como la rueda
   de un futuro entra al día siguiente, el último basis suele ser del día
   hábil anterior.

## Evidencia

En una réplica vacía y migrada, contra los cables reales, con
`pnpm argentina:indicators --soy --apply`:

- primera vuelta: siete corridas `succeeded`, 19.419 puntos (pizarra 6.551 con
  676 `S/C`, BNA 6.067, `ZS=F` 6.573, cuatro series de 57 campañas), 5 requests;
  segunda vuelta: siete `duplicate`, 5 requests;
- almacenamiento: 5,1 MB, ~269 bytes por fila con índices;
- ninguna rueda en fin de semana en las tres series diarias;
- Estimaciones concilia en 56 campañas contra el CSV CC BY;
- basis calculado con `soy-basis-1.0.0` en 5.239 días; faltan 511 sin BNA —casi
  todos antes de 2002— y 125 sin Chicago (feriados de EE. UU.). El 2026-11-03:
  pizarra 540.500 $/t, BNA 1.542, `ZSX26` a 1.203 centavos, basis −20,7 %, en
  período de entrega. Los días de entrega tienen la misma mediana que el resto
  (−27,5 % y −27,3 %): marcarlos sin excluirlos no sesga la serie. 2023 da
  mediana −11,4 % y p90 +9 %: es el «dólar soja», en el que la pizarra en pesos
  no se cobraba al BNA comprador.

En una réplica vacía, con BCRA, INDEC y Series de Tiempo frenados por el kill
switch, abrir `/argentina` planeó un job por fuente y grabó las siete series de
soja y las 20 patas del CCL en 58 s; una segunda visita no planeó nada. El
render con esos datos, a 1440 px en claro y 390 px en oscuro: 0 px de desborde,
ningún `NaN`, `undefined` ni `null`, axe sin serious ni critical con las tablas
abiertas, después de volver enfocables las regiones con scroll de las tablas
(`scrollable-region-focusable`, que afectaba a todos los bloques) y de abrir
medio intervalo el dominio de los gráficos de barras, cuya primera barra tapaba
el eje.

## Consecuencias

- Una corrida completa son cinco requests, todas con la historia entera: una de
  pizarra, una del BNA, una de Chicago y dos del Ministerio. Las cuatro
  variables de Estimaciones salen de un solo `POST` y el CSV CC BY se baja una
  vez; el adaptador los reparte entre las cuatro series de la corrida.
- El cierre de Chicago es el de Yahoo, no el precio de ajuste de CME, que es
  licenciado. No hay contra qué verificarlo; la metodología lo dice.
- El dólar del basis es el que usa la pizarra. Durante el cepo y los programas
  de «dólar soja» el basis en dólares oficiales lee una pizarra que el mercado
  no cobraba en esos dólares; la superficie lo dice, igual que con el CCL
  (ADR 0068).
- Si Yahoo cambia la regla de `ZS=F`, la regla deja de coincidir con los
  contratos individuales que sigan respondiendo; la verificación queda como
  prueba con fixture.
