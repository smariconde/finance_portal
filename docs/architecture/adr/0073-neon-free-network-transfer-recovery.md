# ADR 0073: transferencia de Neon Free y recuperación sin dump periódico

- Estado: aceptado por decisión del owner el 2026-11-09; enmendado el
  2026-11-17 con lo observado al agotarse la transferencia.
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

## Enmienda 2026-11-17: qué ocurre al agotar la transferencia

El 2026-11-09 se anotó el aviso de 100 % de transferencia, pero el
comportamiento exacto del límite no se había observado hasta el 2026-11-17:
ese día la conexión directa al proyecto de análisis falló por cuota. Neon
documenta que exceder el límite de Free suspende el compute, y el bloqueo
alcanzó también a `psql` y `pg_dump`. Para trasladar los datos a otro proyecto u
organización primero hay que recuperar la lectura de la base de origen.

Lo medido entonces: proyecto `finance_portal` con 5.606.183.573 bytes de
transferencia acumulada en el período 2026-11-01 a 2026-12-01, 310 MB lógicos y
una rama. El proyecto de trading, con cuota propia, siguió respondiendo: la
suspensión es por proyecto. Los snapshots manuales se quedan dentro de Neon.
Las nueve descargas completas sí usaron la cuota pública, aunque la métrica
agregada no permite aislar su consumo.

Procedimiento aceptado para recuperar el acceso sin esperar al período
siguiente, y único autorizado para cambiar de plan por este motivo:

1. **Billing → Change plan → Launch** en la organización del proyecto. Launch no
   tiene mínimo mensual y la franquicia de transferencia pasa a 500 GB por
   proyecto.
2. Configurar en **Billing** el umbral acordado para las alertas de gasto antes
   de usar el proyecto. El 2026-11-17 se fijó en US$ 5,00. Neon documenta avisos
   por correo al 80 % y al 100 % del umbral y el servicio sigue consumiendo.
3. Verificar `pnpm db:status:neon`, `pnpm db:trading:status:neon` y una conexión
   con `psql`; después, una ruta de la aplicación.
4. El owner vuelve a **Free** desde **Billing → Change plan** el mismo día.
   Después se comprueban el plan, el consumo del proyecto y su conexión. El
   contador volvió a cero al **subir a Launch**, con el inicio del período a las
   19:46:17 UTC del 2026-11-17. El efecto de volver a Free queda por verificar.

El uso durante Launch se factura según el plan. Consultar en **Billing** el
importe acumulado y la factura para constatar el costo de la operación.

Un dump completo puntual entra en los 500 GB incluidos de Launch, pero sigue
siendo una decisión explícita y separada de esta ADR: la política de esta
decisión continúa sin copia periódica.

## Fuentes

- [Neon: transferencia y cómputo de egress](https://neon.com/docs/introduction/network-transfer).
- [Neon: planes y límites](https://neon.com/docs/introduction/plans).
- [Neon: snapshots y recuperación](https://neon.com/docs/guides/backup-restore).
- [Neon: gestión de facturación](https://neon.com/docs/introduction/manage-billing),
  revisado el 2026-11-17 para el cambio de plan.
- [Neon: alertas de gasto](https://neon.com/docs/introduction/spending-notifications).
