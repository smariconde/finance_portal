# Gasto de la capa IA y llamada de humo

- Slice: `F5-01`
- Decisión: [ADR 0033](../architecture/adr/0033-ai-layer-industry-resolution.md)
- Runtime: personal local o protegido, con PostgreSQL y `OPENROUTER_API_KEY`

Un modelo no se acota contando requests: una llamada puede costar diez veces
otra. Además del tope diario de requests de la
[ADR 0020](source-budgets.md), cada llamada a `openrouter` reserva en
`ai_spend_ledger` su **peor caso** antes de salir y lo liquida después con el
costo que informa el proveedor.

| Tope                | Declarado en código | Quién lo cambia                                                 |
| ------------------- | ------------------- | --------------------------------------------------------------- |
| por tarea           | USD 0,10            | un diff revisable                                               |
| por día UTC         | USD 1,00            | el owner lo **baja** con `--spend-limit`; subirlo, un diff      |
| requests por día    | 100                 | el owner lo baja con `--limit`                                  |
| crédito de la clave | —                   | la cuenta de OpenRouter: el último cinturón, fuera del proyecto |

El peor caso es `bytes del pedido × precio máximo de entrada + max_tokens ×
precio máximo de salida`, con los precios del escalón de
`ai-model-ladder-1.0.0`. Los bytes acotan los tokens porque un token BPE cubre
al menos un byte. Si el peor caso no entra en la tarea o en el día, la llamada
no sale y la tarea se abstiene con `ai_budget_exhausted`.

Cada fila del libro cuenta así:

| Estado      | Qué pasó                                                | Cuenta       |
| ----------- | ------------------------------------------------------- | ------------ |
| `reserved`  | la llamada está en vuelo, o el proceso murió con ella   | el peor caso |
| `charged`   | el proveedor respondió e informó `usage.cost`           | lo cobrado   |
| `uncharged` | no salió nada, o un `4xx`/`429`/`5xx` que no cobra      | cero         |
| `unsettled` | transporte cortado, `2xx` ilegible o costo no informado | el peor caso |

## Ver el gasto

```sh
pnpm ingestion:sources --source openrouter
```

Agrega al estado de la fuente el gasto del día —contado, cobrado, intentos y
reservas abiertas— y el tope por tarea.

## Bajar el tope del día o frenar la fuente

```sh
pnpm ingestion:sources --source openrouter --spend-limit 0.25 --reason "…"          # dry run
pnpm ingestion:sources --source openrouter --spend-limit 0.25 --reason "…" --apply
pnpm ingestion:sources --source openrouter --disable --reason "…" --apply
```

Un `--spend-limit` mayor que el declarado se rechaza. Como todo control, el
nuevo reemplaza al vigente entero: `--disable` o `--enable` sin `--spend-limit`
vuelven al tope declarado.

## Llamada de humo

```sh
pnpm ai:smoke                    # plan: escalera, peor caso y gasto de hoy; no llama
pnpm ai:smoke --rung 1 --apply   # un escalón
pnpm ai:smoke --apply            # la escalera, hasta el primero que acepte
```

La tarea `ai-smoke-1.0.0` pide devolver un token aleatorio tal cual: recorre la
cadena entera —credencial agregada por la puerta, ZDR, schema estricto, costo
informado, libro— sin mandar nada que venga de una fuente. A diferencia del
resto de los comandos, el dry run no sale a la red: acá salir es gastar
dólares. El comando sale con `1` si la tarea no se aceptó.

Qué mirar en la salida:

- `respondió` es el modelo que de verdad contestó (`model` de la respuesta);
- `cobrado` frente a `reservado`: medido el 2026-10-15, cada cobro quedó entre
  11 y 23 veces por debajo de su reserva;
- un `provider_rejected (status 404)` en un escalón suele ser que ningún
  endpoint del modelo cumple ZDR y el precio máximo a la vez: el modelo cambió
  de precio o de proveedores, y corregirlo es una versión nueva de la escalera.

## Si algo falla

- `egress_refused (credential_missing)`: falta `OPENROUTER_API_KEY` en el
  entorno del runtime.
- `provider_unauthorized`: la clave fue rechazada o la cuenta no tiene
  crédito (`401`, `402`, `403`). La corrida frena sin probar otro escalón.
- `breaker_open`: tres fallas de transporte, `429` o `5xx` seguidas. Vive lo
  que vive la corrida; volver a correr más tarde.
- Reservas `reserved` que no se cierran: un proceso murió con la llamada en
  vuelo. Siguen contando su peor caso ese día, a propósito; el día siguiente
  arranca de cero.
