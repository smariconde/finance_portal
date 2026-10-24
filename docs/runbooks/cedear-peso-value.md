# Precio CEDEAR y valor en pesos

Contrato: [ADR 0056](../architecture/adr/0056-cedear-peso-value.md), `F6-08`.
No hay migración, fuente nueva, clave adicional ni gasto IA para esta conversión.

## Preparar identidad

```bash
pnpm cedears:record
pnpm cedears:record --apply
```

Caja publica el símbolo BYMA; Comafi usa su JSON para el programa y sólo el
símbolo de su planilla, reconciliado por ISIN y código de Caja. Comafi hace dos
requests; Caja, una. Ningún payload se guarda. Una planilla rota no cambia el
registro anterior. Una fila sin símbolo corroborado conserva el programa pero no
permite consultar precios por un ticker adivinado.

El listing y símbolo comienzan en la observación. Una corrida anterior conserva
su lectura, sin el símbolo recién visto: volver a valuar registra un corte nuevo.
El universo sigue resolviendo acciones en mercados de EE.UU.; `AAPL` sin venue
sobre el grafo completo puede ser la acción o el CEDEAR.

## Obtener cierres

«Volver a valuar» pide los cierres faltantes con jobs durables bajo el lease de
Yahoo, el contador diario y el kill switch existentes. Un CEDEAR sin cobertura no
bloquea el valor de la acción. Abrir la página sólo lee. Los jobs fallidos o
pendientes se inspeccionan con `pnpm ingestion:jobs`; reintentar es volver a pedir
la valuación. Un plan antiguo con otra versión de parser se cancela con motivo
mediante ese comando antes de volver a planearlo; nunca se edita su versión.

El comando acotado sirve para inspección o ingesta explícita del CEDEAR de una
acción ya resuelta en el universo:

```bash
pnpm prices:ingest --cedear AAPL
pnpm prices:ingest --cedear AAPL --apply
```

El dry run descarga y consume cuota, pero no publica. Se exige símbolo devuelto
igual al pedido, moneda ARS y mercado `BUE`. El precio se guarda crudo en
`security_prices`, sobre la security CEDEAR. La segunda descarga no sobrescribe
filas: reporta duplicados y conflictos. Yahoo conserva `owner_accepted`; no hay
concesión contractual ni uso público. Una negativa del presupuesto ocurre antes
de abrir el socket.

## Leer el resultado

La sección «Acceso por CEDEAR» muestra precio en ARS, CCL implícito (ARS/USD) y
valor en pesos, con fecha, moneda y fuente. El USD sigue siendo la moneda del
motor. Ambos cierres deben ser del `as_of` de la corrida; no se usa una rueda
vecina para cubrir un feriado. No son necesariamente simultáneos ni un tipo de
cambio ejecutable. La conversión conserva el descuento relativo de la acción:
el ratio se cancela algebraicamente en el valor ARS.

No se convierte si faltan programa, símbolo, ratio, precio o valor, si la moneda
no coincide, si un split vuelve incompatibles las bases, o si el ratio se vio
después del día del precio. Actualizar el registro y volver a valuar es la salida
para identidad incompleta. Durante la rueda no se publica intradía; cuando el
último tick de BYMA precede la campana, esa barra espera al siguiente día local.
Un cierre posterior a la corrida no cambia su comparación.

## Evidencia del 2026-10-24

En réplica privada: 153 listings de Comafi y 8 de Caja. Un programa Comafi carece
de símbolo corroborado. AAPL y AMZN al 23/10: precios 28.660 y 2.850 ARS; CCL
1.648,405372 y 1.654,838710 ARS/USD; valores 14.892,87 y 1.648,00 ARS. Ninguna
escritura personal ni llamada IA. Fixtures sintéticas de ambos emisores y de
Yahoo; no se guardan capturas de payloads ni capturas visuales en el repo público.
