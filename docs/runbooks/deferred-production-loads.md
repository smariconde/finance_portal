# Cargas diferidas a Production

- Slices: `F9-17` (ITCRM) y `F9-18` (REM)
- Decisiones: [ADR 0073](../architecture/adr/0073-neon-free-network-transfer-recovery.md),
  [ADR 0074](../architecture/adr/0074-bcra-itcrm-history.md) y
  [ADR 0075](../architecture/adr/0075-bcra-rem-release-forecasts.md)
- Runtime: comandos locales contra la rama `production` de Neon

Los dos slices están integrados: código en `main`, migración `0050` aplicada en
Neon y carga probada en PostgreSQL local. Falta publicar sus datos en Neon y
comprobarlos en el deployment protegido. Se difirió porque el proyecto agotó
los 5 GB de transferencia de noviembre de 2026; la cuota se renueva el
2026-12-01 a las 00:00 UTC. Que el código esté desplegado **no** prueba que los
datos existan en Production.

## Antes de empezar

1. Leer `data_transfer_bytes` del período en la consola de Neon (Usage) o con
   el MCP de Neon, y anotarlo. Al final se compara para medir lo que costó la
   carga.
2. `pnpm db:status:neon` tiene que salir sin pendientes (51 de 51 al
   2026-11-13). Estas cargas no cambian el schema, así que no piden snapshot.
3. Contra Neon, cada comando lleva los dos archivos de entorno; el último gana:

```sh
NEON="node --env-file=.env.local --env-file=.env.neon.local --conditions=react-server --import tsx"
```

## `F9-18`: REM de octubre de 2026

1. En seco, que baja y no escribe (dos requests al BCRA):

   ```sh
   $NEON scripts/record-rem-release.ts --round 2026-10
   ```

   Esperado: publicación del 2026-11-05 y siete meses objetivo, de octubre de
   2026 a abril de 2027. En local bajó 158.118 bytes.

2. Si coincide, publicar las siete medianas en una transacción:

   ```sh
   $NEON scripts/record-rem-release.ts --round 2026-10 --apply
   ```

3. La comparación necesita `ipc_nacional` con el dato de octubre. Al 2026-11-13
   la API del INDEC todavía terminaba en septiembre. Necesita `INDEC_API_TOKEN`
   ([runbook](indec-token.md)). Primero en seco:

   ```sh
   $NEON scripts/record-argentina-indicators.ts --indicator ipc_nacional
   ```

   Si trae octubre, repetir con `--apply`. Si no, la tabla muestra «Pendiente»:
   es el comportamiento correcto y no se fuerza otra fuente.

## `F9-17`: ITCRM diario

1. En seco (una request al XLSX del BCRA):

   ```sh
   $NEON scripts/record-argentina-indicators.ts --indicator itcrm_daily
   ```

   En local publicó 10.907 puntos, del 1997-01-01 al 2026-11-11; en diciembre
   habrá algunos más.

2. Si el plan coincide, repetir con `--apply`.

## Comprobar en el deployment protegido

Abrir `/argentina` **una vez**. Al abrirse planea la actualización de lo que
esté atrasado (ADR 0070), y eso también gasta transferencia.

- Inflación: la ronda REM de octubre, sus siete meses, la publicación del
  2026-11-05 y el error de octubre en puntos porcentuales, o «Pendiente» si
  falta el IPC.
- Dólar: el ITCRM con su base, la fecha observada y la metodología. El gráfico
  lee los días de los últimos cinco años y un cierre por mes antes.

## Al terminar

1. Volver a leer `data_transfer_bytes` y anotar la diferencia.
2. Registrar en el backlog, bajo cada slice: fecha, cantidades publicadas, lo
   que mostró el tablero y los bytes. Hasta ese registro, ninguno de los dos
   slices está comprobado en Production.
