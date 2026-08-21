# Sistema de valuacion robusto

## Filosofia

El sistema combina modelo, evidencia y narrativa, pero mantiene separadas sus responsabilidades:

```text
datos -> normalizacion -> clasificacion -> propuesta de supuestos
      -> policy checks -> motor deterministico -> escenarios/sensibilidad
      -> diagnosticos -> explicacion con citas
```

La valuacion se guarda como snapshot reproducible. Recalcular el snapshot aceptado con el mismo input, politica numerica y version del engine devuelve el mismo resultado; una simulacion usa seed guardado. Volver a pedir supuestos a una IA crea una corrida nueva y no promete la misma respuesta.

## Arquetipos y metodos

| Arquetipo | Metodo principal | Cross-check | Evitar |
|---|---|---|---|
| No financiera madura | FCFF/FCFE estable o 2 etapas | multiples fundamentales | crecimiento terminal agresivo |
| Alto crecimiento | FCFF 3 etapas, revenue-to-margin | EV/Sales ajustado por margen | extrapolar crecimiento sin convergencia |
| Perdidas/early stage | revenue-to-margin + prob. supervivencia | ventas/usuarios con descuento | P/E |
| Banco | excess return/residual income o DDM | P/B vs ROE-cost of equity | FCFF/WACC estandar |
| Aseguradora | excess return/DDM | P/B, combined ratio | tratar reservas como deuda normal |
| REIT | AFFO/FCFE/DDM | P/AFFO, NAV | FCF industrial sin ajustes |
| Ciclica | FCFF con margen normalizado | EV/EBITDA de ciclo | ultimo ano como run-rate |
| Commodity | FCFF con precio normalizado | valor de reservas/NAV | spot actual perpetuo |
| Holding | SOTP/NAV | descuento historico | DCF consolidado opaco |
| Distress | APV/escenarios/liquidacion | recovery values | perpetuidad base sin distress |

La cobertura se implementa por fases. Un metodo no implementado devuelve `unsupported_method` con explicacion, no cae silenciosamente a FCFF.

## Selector de metodo

Entradas deterministicas:

- sector/industria y regulacion;
- signo/persistencia de EBIT, net income y FCFF;
- crecimiento, margen y estabilidad;
- payout/dividendos;
- apalancamiento y restriccion de capital;
- exposicion a commodity/ciclo;
- estructura holding/segmentos;
- calidad/cobertura de datos.

El selector retorna `asset_profile`, `recommended_method`, `alternatives`, `required_inputs`, `confidence` y reglas activadas. La IA puede proponer un cambio solo en un schema cerrado. El policy engine decide y registra la diferencia.

## Normalizacion previa

- Separar operativo/no operativo y cash necesario/exceso.
- Capitalizar R&D cuando sea material y haya historia suficiente.
- Tratar leases de forma consistente con EBIT/deuda.
- Normalizar one-offs, adquisiciones, restructuraciones y tax rate.
- Usar acciones diluidas y considerar opciones/RSUs.
- Para ciclos, usar 5-10 anos o un ciclo completo y margenes escalados, no promedio absoluto si la empresa cambio de tamano.
- Preservar reported y adjusted en paralelo; ningun ajuste sin puente y razon.

## Supuestos estructurados

```ts
type Assumption = {
  key: string;
  value: string;
  unit: string;
  category: "operating" | "reinvestment" | "risk" | "terminal" | "adjustment";
  sourceType: "reported" | "market" | "damodaran" | "analyst" | "ai_proposed" | "user";
  evidenceIds: string[];
  asOf: string;
  confidence: number;
  allowedRange: { min: string; max: string };
  rationale: string;
  lockedByUser: boolean;
};
```

Guardar numeros sensibles como decimal string en el contrato para evitar round-trips ambiguos.

La politica numerica define libreria Decimal, precision interna, unidades base, redondeo solo en bordes de presentacion y serializacion canonica usada para el hash. Nunca mezclar `number` y decimal string dentro del motor sin conversion explicita.

## FCFF no financiera

- Pronosticar revenue, EBIT margin, tax rate y reinversion explicitamente.
- `NOPAT = EBIT * (1 - tax_rate)`.
- `FCFF = NOPAT - reinvestment`.
- La reinversion puede derivarse de sales-to-capital o `growth / ROIC`; no asumir crecimiento gratis.
- Descontar con WACC consistente con moneda y flujos.
- Terminal: crecimiento sostenible, margen estable, ROIC/payout coherentes y `WACC > g` con buffer minimo.
- Puente: PV operaciones + cash/exceso + activos no operativos - deuda - minority interest - claims, dividido por acciones diluidas.

## Riesgo y costo de capital

- Elegir moneda de valuacion primero. El risk-free corresponde a esa moneda.
- Usar ERP implicita madura y CRP con fecha/version.
- Country risk se pondera por exposicion de ingresos/operaciones cuando haya datos, no solo sede.
- Preferir beta bottom-up sectorial, desapalancada y reapalancada a estructura objetivo.
- Costo de deuda = risk-free + default spread; tax shield con tasa marginal plausible.
- Convergencia de beta, leverage y costo de capital hacia estado estable.

## Financieras

El valor depende de equity capital, ROE, cost of equity, crecimiento y payout. En estado estable:

- `retention_ratio = growth / ROE`;
- `payout_ratio = 1 - retention_ratio`;
- excess return valora el PV de `(ROE - Ke) * beginning_book_equity` mas book equity actual.

Validar capital regulatorio, calidad de activos y metricas sectoriales. Depositos/float no se tratan como deuda industrial comun.

## Ciclicas y commodities

- Normalizar margen sobre el ciclo o modelar unidades por precio normalizado.
- Registrar ventana, inflacion y razon de normalizacion.
- Escenarios incluyen precio/margen, volumen, FX, capex y costo de capital.
- Comparar resultado contra un escenario spot para que el usuario vea cuanto depende de la tesis de commodity.

## IA con evidencia

### Usos permitidos

- clasificar arquetipo con argumentos;
- extraer guidance/riesgos de documentos entregados;
- proponer rangos de crecimiento, margen y convergencia;
- mapear narrativa a supuestos;
- explicar drivers y diferencias entre escenarios.

### Usos prohibidos

- calcular DCF o WACC en texto libre;
- inventar consenso, betas, ERP o citas;
- navegar sin registrar URLs/documentos;
- sobreescribir un supuesto bloqueado;
- presentar recomendacion personalizada.

Usar salida JSON Schema estricta, Zod, temperature baja, model allowlist, max tokens y timeout. OpenRouter debe requerir soporte de parametros estructurados y, cuando aplique, ZDR. El prompt recibe evidence IDs y hechos compactos, no credenciales ni payloads completos.

Cada corrida registra modelo solicitado, modelo/proveedor efectivo, routing/fallbacks, parametros, politica de datos, prompt version, response ID, costo y output original. Aplicar por request `zdr`, `data_collection=deny` y allowlist cuando corresponda; una variable de entorno es configuracion de la app, no evidencia de que el proveedor aplico la politica. El replay usa el output persistido, no vuelve a invocar al modelo.

## Policy engine

Checks minimos:

- `discount_rate > terminal_growth + buffer`;
- shares > 0; resultados finitos;
- terminal growth acotado por realidad macro de la moneda;
- margen terminal dentro de rango sectorial o justificado;
- ROIC, growth y reinversion coherentes;
- payout entre 0 y 1 salvo justificacion transitoria;
- tax rate y leverage plausibles;
- terminal value share del EV marcado si es excesivo;
- exposure weights suman 100%;
- freshness y campos requeridos por metodo.

Modos: `reject`, `require_review` o `autocorrect_with_trace`. Produccion no corrige silenciosamente.

## Salida

```json
{
  "ticker": "AAPL",
  "as_of": "YYYY-MM-DD",
  "currency": "USD",
  "engine_version": "semver+gitsha",
  "asset_profile": "stable-non-financial",
  "valuation_method": "fcff_three_stage",
  "method_selection": {},
  "assumptions": [],
  "scenarios": { "bear": {}, "base": {}, "bull": {} },
  "result": {
    "enterprise_value": "0",
    "equity_value": "0",
    "intrinsic_value_per_share": "0",
    "current_price": "0",
    "upside_downside_pct": "0",
    "reference_discount_prices": []
  },
  "sensitivity": {},
  "cross_checks": {},
  "diagnostics": { "model_risk": "medium", "data_quality": "high", "checks": [] },
  "evidence": []
}
```

Los precios con descuento son escenarios matematicos configurables para uso del owner, no una recomendacion publicada. La demo los presenta solo con fixtures y metodologia; no se personalizan por perfil, patrimonio ni tolerancia al riesgo.

## Incertidumbre y validacion de modelo

El output principal es un rango con drivers, no una cifra de falsa precision. Bear/base/bull declara probabilidades solo si existe base defendible; sensitivity no equivale a probabilidad. Monte Carlo se habilita cuando haya distribuciones justificadas, correlaciones, seed y tests, nunca como decoracion.

Cada metodo nuevo necesita owner, estado (`experimental | reviewed | production`), limitaciones, fixtures independientes y revision humana. Una comparacion con una spreadsheet publica es necesaria pero no suficiente: documentar diferencias de convencion y, para formulas criticas, usar calculo alternativo o revision independiente para evitar un oracle circular.

## Validacion de referencia

- Golden fixtures manuales y contra spreadsheets publicas de Damodaran.
- Property tests: mayor WACC no aumenta valor ceteris paribus; mayor deuda reduce equity value solo si EV, cash y demas inputs permanecen fijos; escenarios quedan ordenados cuando sus supuestos lo permiten.
- Mutation tests o cobertura enfocada en formulas criticas.
- Dataset de eval de metodo con empresas de cada arquetipo.
- Toda discrepancia conocida se documenta con formula, convencion y tolerancia.
