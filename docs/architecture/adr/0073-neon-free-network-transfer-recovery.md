# ADR 0073: transferencia de Neon Free y recuperación sin dump periódico

- Estado: aceptado por decisión del owner el 2026-11-09.
- Relacionadas: [ADR 0057](0057-neon-hosted-postgres.md),
  [despliegue protegido](../../runbooks/protected-deployment.md).

## Contexto

Neon Free incluye 5 GB de transferencia pública por proyecto y mes. Cuenta los
bytes que PostgreSQL envía por el proxy, tanto con conexiones pooled como
directas. Un `pg_dump -Fc --compress=9` comprime el archivo **después** de la
transferencia; los 34 MB del archivo no miden el egress que consumió la copia.

El 2026-11-09 Neon informó 5.026.472.450 bytes transferidos en el período
2026-11-01 a 2026-12-01, cerca del límite mensual. La rama `production` ocupa
304 MB lógicos; sus tablas ocupan 155 MB sin índices. El timer local produjo
nueve dumps completos del 2 al 9 de noviembre. Neon no desglosa la transferencia
por consulta o conexión, así que no atribuimos los 5 GB completos al backup.
Un dump diario de una base que crece compite con las lecturas del producto por
la misma cuota y puede suspender el compute.

El owner declaró que no necesita un respaldo local periódico y pidió deshabilitar
toda esa configuración. Neon Free ofrece una ventana de recuperación de seis
horas y un snapshot manual, sin programación automática de snapshots. Aceptamos
que, fuera de esa ventana y de un snapshot manual vigente, puede no haber punto
de recuperación. No se presenta como una política de recuperación diaria.

## Decisión

1. Se retiran el timer y servicio de usuario, su configuración versionada, el
   script de `pg_dump` desde Neon y su test de retención. Los dumps existentes
   quedan privados e inertes; retirarlos o borrarlos es una decisión aparte.
2. No hay backup local periódico ni descarga automática completa de Neon. Antes
   de una migración de Production, el owner verifica el uso y crea o confirma
   un snapshot manual reciente en Neon, sin copiar la base por el proxy. El
   procedimiento de migración se detiene si no puede establecerse un punto de
   recuperación aceptable.
3. Free admite un solo snapshot manual. Si el lugar está ocupado, no se borra
   automáticamente el anterior: el owner decide si reemplazarlo, posponer la
   migración o cambiar de plan. Ninguna de estas opciones se ejecuta como
   efecto lateral de `pnpm db:migrate:neon`.
4. Se observa `data_transfer_bytes` del proyecto antes de cargas o pruebas
   grandes. Cada nueva lectura masiva tiene que acotar filas y columnas o
   justificar su volumen; la cifra de Neon es agregada y no prueba qué query
   causó una subida.

## Consecuencias

- Desaparece el consumo diario inevitable del dump; las consultas y cargas
  siguen consumiendo transferencia y requieren medición propia.
- Se pierde la copia diaria fuera de Neon. Un snapshot manual está dentro del
  mismo proveedor y no sustituye una copia externa ante un incidente del
  proveedor o de la cuenta. Esta limitación es aceptada para la instancia
  personal en Free, con la decisión explícita del owner.
- Cambia el gate previo al merge de una migración: snapshot verificado, después
  `pnpm db:migrate:neon` y `pnpm db:status:neon`. Sin snapshot disponible y
  revisado no se integra el PR que cambia el schema.

## Fuentes

- [Neon: transferencia y cómputo de egress](https://neon.com/docs/introduction/network-transfer).
- [Neon: planes y límites](https://neon.com/docs/introduction/plans).
- [Neon: snapshots y recuperación](https://neon.com/docs/guides/backup-restore).
