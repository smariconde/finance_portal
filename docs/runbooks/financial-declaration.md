# Declaración privada para bancos y aseguradoras

La app deriva el ROE desde utilidad y patrimonio **comunes** y el costo de
equity desde releases fechadas. Para calcular, el owner debe registrar payout
y tres revisiones con una cita. Si la SEC no publica patrimonio común directo,
también declara los saldos de dos cierres consecutivos. No use patrimonio
total como sustituto sin separar preferentes y participaciones no controlantes.

El archivo se guarda fuera del repositorio. Forma de ejemplo, con cifras
**sintéticas** que deben reemplazarse antes de `--apply`:

```json
{
  "fiscalYearEnd": "2025-12-31",
  "payout": "0.45",
  "rationale": "Distribución revisada contra resultados y capital distribuible del ejercicio.",
  "sourceDocumentId": "10-K y nota revisada por el owner",
  "regulatoryCapital": "Describir el capital regulatorio y cualquier limitación a distribuir.",
  "assetQuality": "Describir cartera, reservas o suficiencia actuarial y sus riesgos.",
  "cleanSurplus": "Reconciliar patrimonio común, OCI y transacciones de capital.",
  "commonBook": {
    "currentValue": "120000000000",
    "priorValue": "100000000000",
    "priorFiscalYearEnd": "2024-12-31",
    "currency": "USD"
  }
}
```

Si `companyfacts` publica ambos saldos de patrimonio común, use
`"commonBook": null`; los valores de la SEC tienen prioridad. El CLI no
valida la verdad de la transcripción: el owner debe verificar unidades,
consolidación, preferentes, fecha y cita. Una revisión escrita no certifica
solvencia ni eleva el rigor `screening`.

```bash
pnpm valuation:financial-declare --ticker JPM --file /ruta/privada/jpm.json
pnpm valuation:financial-declare --ticker JPM --file /ruta/privada/jpm.json --apply
```

El primer comando valida y resuelve identidad sin escribir. `--apply` agrega
una fila, no edita otra. Un nuevo pedido en `/valuacion` usa sólo una
declaración que ya existía al corte del pedido. El historial anterior no
cambia. `pnpm valuation:assess --ticker JPM --offline` evalúa sólo hechos y
releases, sin cargar declaraciones; el job por ticker sí las lee.
