# Cargas diferidas a Production

- Slices: `F9-17` (ITCRM) y `F9-18` (REM)
- Estado: **cerrado el 2026-11-17**. Las dos cargas están publicadas en la rama
  `production` de Neon y comprobadas contra el portal.
- Decisiones: [ADR 0073](../architecture/adr/0073-neon-free-network-transfer-recovery.md),
  [ADR 0074](../architecture/adr/0074-bcra-itcrm-history.md) y
  [ADR 0075](../architecture/adr/0075-bcra-rem-release-forecasts.md)
- Runtime: comandos locales contra la rama `production` de Neon

Los dos slices quedaron integrados en `main` a mediados de noviembre de 2026, con
la migración `0050` aplicada en Neon y la carga probada en PostgreSQL local. La
publicación se difirió porque el proyecto agotó los 5 GB de transferencia de
noviembre: al llegar al límite Neon suspendió el compute y toda conexión —incluido
`pg_dump`— devolvía «Your account or project has exceeded the quota»
(ver la enmienda del 2026-11-17 en la ADR 0073).

## Registro del 2026-11-17

El owner subió la organización a Launch para recuperar el acceso y fijó un
`Spending limit` de US$ 5,00. Con el proyecto operativo se aplicaron las dos
cargas pendientes, en este orden:

| Carga                 | Comando                                                          | Resultado                                                                          |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ITCRM (`F9-17`)       | `record-argentina-indicators.ts --indicator itcrm_daily --apply` | 10.913 puntos, 1997-01-01 a 2026-11-17, 0 nulos, 1 request, 3.680.405 bytes leídos |
| REM octubre (`F9-18`) | `record-rem-release.ts --round 2026-10 --apply`                  | 7 pronósticos, publicación 2026-11-05, 2 requests, 158.122 bytes, `accepted: 7`    |

Corridas registradas: `b6719b05-9e95-45d1-a1a8-9470f7afc991` (ITCRM, `succeeded`)
y `83ddc357-6fb1-4434-bea0-8d5c9a5672fd` (REM, `succeeded`). La definición de
`itcrm_daily` quedó en revisión 0 con `available_at` del 2026-11-17; los siete
pronósticos del REM conservan `published_on` 2026-11-05 y `available_at`
2026-11-06T03:00Z.

Medianos guardados del REM de octubre de 2026, en porcentaje mensual: octubre
1,8 · noviembre 1,7 · diciembre 1,84 · enero 1,7 · febrero 1,6 · marzo 1,7 ·
abril 1,66.

Estado de los esquemas al empezar y al terminar: `pnpm db:status:neon` 53 de 53,
`pnpm db:trading:status:neon` 8 de 8 y `pnpm db:trading:audit:neon` con las ocho
comprobaciones sobre 17 tablas.

## Comprobación en el portal

`/argentina` respondió `200` contra Neon y pasó de 1.738.701 a 1.912.809 bytes:
ese crecimiento es la serie del ITCRM que antes no existía. El bloque muestra
«ITCRM 79,7, contra 100 el 17/12/2015» y el REM titula «REM oct 2026 · publicado
05/11/2026» con sus siete meses objetivo. No aparecieron `NaN`, `Infinity` ni
«No disponible».

Los siete meses del REM siguen mostrando **«Pendiente»**: la API del INDEC
todavía termina en 2026-09-01, así que el IPC de octubre no existe y la
comparación no se puede calcular. Es el comportamiento correcto; no se fuerza
otra fuente.

## Repetir la comprobación

`pnpm db:status:neon` no debe tener pendientes. Contra Neon, cada comando lleva
los dos archivos de entorno; el último gana:

```sh
NEON="node --env-file=.env.local --env-file=.env.neon.local --conditions=react-server --import tsx"
```

En seco no escribe:

```sh
$NEON scripts/record-argentina-indicators.ts --indicator itcrm_daily
$NEON scripts/record-rem-release.ts --round 2026-10
```

Abrir `/argentina` **una vez** en el deployment protegido: al abrirse planea la
actualización de lo que esté atrasado (ADR 0070), y eso también gasta
transferencia. Anotar `data_transfer_bytes` del período antes y después; la cifra
de Neon se agrega por hora y no atribuye el consumo a una consulta.

Cuando el INDEC publique el IPC de octubre de 2026, repetir
`--indicator ipc_nacional --apply` y volver a abrir `/argentina`: esos siete
meses deberían pasar de «Pendiente» a la comparación con su error en puntos
porcentuales.
