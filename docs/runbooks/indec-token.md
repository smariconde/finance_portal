# Token del Catálogo API-INDEC y registro de indicadores argentinos

- Slice: `F9-04`
- Decisión: [ADR 0069](../architecture/adr/0069-argentina-activity-fiscal-external.md)
- Runtime: personal local o protegido, con PostgreSQL

El Catálogo API-INDEC exige un **token JWT** de la cuenta del owner. La puerta
de salida lo agrega como `Authorization: Bearer` sólo para la fuente
`indec-api`, después de autorizar el destino; ningún adaptador lo ve y ninguna
página lo lee. El token **vence a los 12 meses** de generado y regenerarlo
revoca el anterior en el acto.

## Cargar o renovar el token

1. Entrar a <https://api.indec.gob.ar/> con el correo del owner (llega un código
   de verificación; puede tardar hasta 5 minutos).
2. «Gestionar la cuenta» → generar el token. Se muestra **una sola vez**.
3. Guardarlo en `.env.local` como `INDEC_API_TOKEN=<token>`, sin comillas ni
   espacios. En un deployment protegido, en la variable de entorno del
   proyecto. Nunca en el repositorio, en un issue ni en un chat.
4. Verificar con una corrida en seco:

```sh
pnpm argentina:indicators --indicator emae_sa
```

Anotar la fecha de generación: once meses después hay que repetir estos pasos.

## Síntomas

| Lo que dice el comando                                                  | Qué pasó                                                        | Qué hacer                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Egress blocked (credential_missing) for "indec-api": INDEC_API_TOKEN.` | la variable no está en el entorno del proceso                   | cargarla (paso 3); no sale ningún request                         |
| `Egress blocked (credential_invalid) …`                                 | el valor tiene espacios, saltos de línea o es demasiado corto   | volver a copiarlo sin comillas ni espacios                        |
| `unauthorized: emae_…` y la línea `token`                               | el INDEC respondió `401`/`403`: venció o se regeneró            | renovarlo; la corrida se detuvo y lo guardado no cambió           |
| `rate_limited` con `Retry-After`                                        | el INDEC pidió parar; sus límites no están publicados           | esperar lo indicado; no reintentar en bucle                       |
| `no_rows: emae_sector_…`                                                | el filtro declarado ya no devuelve filas (un sector renombrado) | revisar el servicio y cambiar la declaración en un diff revisable |
| `schema_changed (…)`                                                    | el servicio cambió de columnas, filtros o signos                | no forzar: actualizar `INDEC_SERVICES` con su prueba              |

## Registrar los indicadores

```sh
pnpm argentina:indicators --declared                  # en seco: baja y planea, no escribe
pnpm argentina:indicators --declared --apply          # 25 series: 19 del INDEC y 6 de Series de Tiempo
pnpm argentina:indicators --indicator emae_sa --apply
pnpm argentina:indicators --declared --apply --accept-mass-change   # el owner acepta un cambio masivo
```

Cada corrida lee la historia entera de la serie y la compara con la guardada:
lo nuevo, lo revisado y lo retirado salen de esa comparación, y una vuelta sin
novedades queda `duplicate`. Si más de un décimo de lo comparado cambia de
golpe —un rebase o una revisión metodológica—, la corrida queda `quarantined` y
no publica nada hasta que el owner lo acepte con `--accept-mass-change`.

Contra la base de Production (Neon), con los dos archivos de entorno y el último
ganando:

```sh
node --env-file=.env.local --env-file=.env.neon.local --conditions=react-server \
  --import tsx scripts/record-argentina-indicators.ts --declared --apply
```

El presupuesto diario se cuenta en la base contra la que se corre: una vuelta
en la réplica no descuenta de la de Production, pero el INDEC sí la ve.
