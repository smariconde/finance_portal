# ADR 0074: ITCRM oficial diario y revisiones observadas

- Estado: aceptada para `F9-17`.
- Fecha: 2026-11-12.
- Relacionadas: [ADR 0069](0069-argentina-activity-fiscal-external.md),
  [ADR 0070](0070-argentina-refresh-on-open.md) y
  [ADR 0073](0073-neon-free-network-transfer-recovery.md).

## Contexto

La pregunta de `F9-17` es cómo cambió la competitividad cambiaria real frente a
su propia historia. El BCRA publica el ITCRM diario en un XLSX, con base
17/12/2015 = 100, y una metodología aparte. El índice es un promedio geométrico
encadenado de tipos bilaterales reales, ponderado por el comercio de
manufacturas. El BCRA estima los IPC recientes y luego revisa los puntos cuando
aparecen el REM, el IPC y los datos de comercio. El libro no trae una fecha de
publicación por fila.

La inspección del archivo oficial el 2026-11-12 halló tres hojas; sólo la primera,
`ITCRM y bilaterales`, contiene el ITCRM diario en su columna B. La columna A es
un serial de Excel. Se leyeron 10.907 puntos entre 1997-01-01 y 2026-11-11; el
archivo tenía 3.679.044 bytes y SHA-256
`a789769b760e81557e5a2046571cf06277537e1df11c8397cc9ac9c1e8f81bce`.
El libro real no se incorpora al repositorio público.

El [aviso legal del BCRA](https://www.bcra.gob.ar/aviso-legal/) permite la
reutilización informativa, educativa o académica con atribución e integridad de
contexto, y requiere autorización para uso comercial. El portal personal usa la
serie para lectura, sin exportar el libro ni transferirlo a IA.

## Decisión

1. La fuente `bcra-itcrm-xlsx` sólo puede pedir el XLSX oficial. Tiene diez
   requests por día, un límite de 8 MiB por respuesta y no sigue redirects. El
   comando manual `pnpm argentina:indicators --indicator itcrm_daily` hace una
   descarga en seco; `--apply` publica el plan en PostgreSQL. No se suma al
   refresh automático al abrir la página.
2. `bcra-itcrm-xlsx-1.0.0` comprueba la hoja, la base, el encabezado, los días
   ascendentes y el valor positivo y finito. Conserva el decimal textual de la
   celda. Rechaza un libro deformado sin publicar ningún punto. La ampliación
   del límite de descompresión del lector XLSX se pasa únicamente en esta
   llamada: la hoja oficial ocupa 8,83 MiB inflados; los demás lectores
   mantienen sus topes anteriores.
3. El registro de indicadores guarda sólo `itcrm_daily` normalizado, su
   definición y las revisiones de cada día. `available_at` es la hora de la
   descarga observada, no una fecha retroactiva inferida. La guarda de cambios
   masivos del registro sigue aplicando. Se descarta el libro tras parsearlo.
4. `/argentina` muestra el nivel, la fecha del punto y la observación de la
   versión, junto con una línea con rangos. Hasta cinco años usa días; para la
   historia larga usa el último dato de cada mes. La base 100 no es un valor
   justo del dólar y la sección no da una señal para dolarizarse.

## Consecuencias

No se agregan migraciones ni llamadas a Neon para desarrollar o probar el
parser. La primera carga local puede insertar unos 11.000 puntos; una carga en
Production consumirá transferencia y requiere medir la cuota de Neon antes de
ejecutarla. Una revisión histórica sólo puede reconstruirse desde la primera
descarga observada por el proyecto, no antes.
