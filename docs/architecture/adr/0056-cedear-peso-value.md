# ADR 0056: precio CEDEAR y conversión a pesos

- Estado: aceptado para implementación de `F6-08`.
- Fecha: 2026-10-24.
- Relacionadas: ADR 0026, 0027, 0048 y 0051.

## Decisión

Se extiende la fuente personal `yahoo-finance` ya aceptada por el owner:
`<símbolo BYMA>.BA`, cierre diario crudo en ARS sobre la security depositaria.
No se contrata un feed ni se acepta un término nuevo. Los derechos siguen en
`owner_accepted`, sin payload guardado, display público ni transferencia a IA.
El contador y el lease de Yahoo son los existentes; no hay llamadas al render.

El símbolo local viene de la columna «Símbolo BYMA» de Caja de Valores. Para
Comafi, el JSON no lo declara: se lee únicamente el símbolo local de su listado
`custodiaglobal/Multimedios/otros/14779.xlsx`, publicado desde su página de
programas, reconciliado por ISIN y código de Caja contra el JSON. La planilla
no aporta ratios, estado ni subyacente: sus desacuerdos ya están documentados en
ADR 0027. Se agrega sólo ese path a la puerta existente y se descarta el libro.
La disponibilidad es la observación de ambas publicaciones; no se retrofecha.

Se registra un listing `XBUE`, ARS y su ticker versionado sobre el CEDEAR, sin
fusionarlo con la acción. Un cambio observado supersede el símbolo anterior;
antes del nuevo conocimiento se conserva la respuesta anterior. Una fila sin
símbolo corroborado conserva el programa y nombra la ausencia.

La corrida por ticker descarga los cierres faltantes del subyacente y de sus
CEDEAR con listing conocido mediante los jobs durables existentes. Cada serie
valida símbolo, moneda y mercado antes de publicar. Un error CEDEAR no impide
valuar la acción. La superficie lee únicamente almacenamiento.

## Regla financiera

`cedear-peso-value-1.0.0`, derivación al leer, fuera del snapshot y sus hashes:

```text
CCL implícito (ARS/USD) = cierre CEDEAR ARS × CEDEAR por acción / cierre acción USD
valor CEDEAR ARS = valor CEDEAR USD × CCL implícito
```

Ambos cierres deben corresponder exactamente al `as_of` de la corrida. No se
busca otro día ni se mezcla el cierre posterior. El ratio y símbolo deben ser
vigentes y conocidos al corte; se rechazan moneda incompatible, precio no
positivo, valor ausente, ratio observado después del día del precio, splits posteriores
a la base de acciones y splits del CEDEAR desde la observación del ratio. Es una
referencia de dos cierres diarios, que no necesariamente fueron simultáneos:
no es un dólar ejecutable, un feed CCL, ni una estimación independiente del
valor. El ratio se cancela algebraicamente: el descuento relativo es el mismo
que el del subyacente. Sin inputs comparables, `null` con motivo.

## Cierre diario e identidad

El sondeo del 2026-10-24 devolvió ARS y mercado `BUE` para `AAPL.BA` y
`UBER.BA`. Ambos sellaron el último tick segundos antes de las 20:00 UTC.
`cedear-settled-session-1.0.0` mantiene la guarda existente el mismo día y
admite esa rueda sólo desde el siguiente día calendario local, con la hora de
asentamiento cumplida y sesión declarada. Nunca admite una barra futura; sin
sesión conserva el rechazo conservador. La política queda en la corrida de
precios y en su clave de contenido. No cambia la política de la referencia.

`yahoo-chart-1.2.0` lee además el mercado. El importador valida símbolo, moneda
y mercado antes de escribir. Los workflows por ticker declaran alcance de
listings estadounidenses: `AAPL` sin venue sobre el grafo entero es ambiguo
cuando existe su CEDEAR, y el resolvedor general conserva esa respuesta.

Caja agregó una columna final «Prospecto»: el parser `cajval-cedears-html-1.1.0`
acepta la forma anterior y esa extensión exacta, verifica todas las cabeceras y
rechaza cualquier otra columna corrida. No guarda los enlaces ni los abre.

## Verificación y revisión

Fixtures sintéticas, sin conservar payloads de Yahoo o Comafi. Contratos de
schema, fuente caída, identidad y moneda incorrectas, falta de cierres, ratio
cambiado, conocimiento posterior, idempotencia y conversión decimal. Revisión
renderizada desktop/mobile con fechas, monedas, fuente y limitación visibles.
Reabrir si cambian cobertura, formato o derechos, o si se necesita cotización
intradía, otra especie de liquidación o superficie pública.

Fuentes revisadas: [Comafi](https://www.comafi.com.ar/custodiaglobal/programas.aspx),
[Caja de Valores](https://cajadevalores.com.ar/Servicios/Cedears) y
[Yahoo AAPL.BA](https://es.finance.yahoo.com/quote/AAPL.BA/history/).
