# ADR 0075: Pronósticos REM por publicación y mes objetivo

- Estado: aceptada para `F9-18`, implementación en progreso.
- Fecha: 2026-11-12.
- Relacionadas: [ADR 0065](0065-bcra-monetary-catalog-vintages.md),
  [ADR 0069](0069-argentina-activity-fiscal-external.md) y
  [contrato point-in-time](../../data/point-in-time-contract.md).

## Contexto

`F9-18` compara la mediana de inflación mensual que esperaba el REM con el IPC
nacional observado para **ese mismo mes**. El BCRA publica informes mensuales
con su fecha de publicación y una planilla propia. La
[página del REM](https://www.bcra.gob.ar/relevamiento-expectativas-mercado-rem/)
indica que la encuesta se realiza en los últimos tres días hábiles del mes y
que sus pronósticos son de los participantes, no del BCRA. La edición de octubre
de 2026 se publicó el 5 de noviembre y contiene siete meses objetivo.

El libro [histórico del REM](https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-historico.xlsx)
consultado el 2026-11-12 tenía 844 medianas nacionales mensuales en 125 rondas.
Trae `Fecha de pronóstico` y `Período`, pero no la fecha de publicación de cada
ronda; además, el archivo se actualiza. No puede usarse por sí solo como prueba
de qué valor estaba disponible en cada fecha histórica.

La planilla de la [edición de octubre de 2026](https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-2026-10.xlsx)
tiene la hoja `Cuadros de resultados`, el bloque `IPC nivel general-Nacional`,
`Mediana` y el período objetivo como último día de cada mes. El parser convierte
ese período al mes sin confundirlo con la ronda. El libro se inspeccionó en
`/tmp` (90.773 bytes); no se incorpora al repositorio.

## Decisión

1. Una observación REM tiene al menos ronda, mes objetivo, mediana porcentual,
   fecha de publicación de esa edición, fecha de descarga, fuente y revisión
   observada. Ronda y mes objetivo forman una clave distinta del período del IPC.
   No se modelan rondas como revisiones de una única serie de inflación.
2. Para la lectura histórica se parte de las **ediciones individuales** y sus
   páginas de publicación. El libro histórico sólo sirve para descubrir o
   cotejar rondas; no asigna retroactivamente fechas de disponibilidad. La
   primera versión del parser acepta el formato de la edición de octubre de
   2026 y falla cerrada si cambia el bloque, el encabezado o el mes objetivo.
3. La fecha pública de una edición se toma de la página oficial y se convierte
   de forma conservadora al inicio del día siguiente en Argentina cuando no hay
   hora. `recorded_at` conserva cuándo la instalación obtuvo el documento.
   Una corrección detectada después es otra versión con nueva disponibilidad;
   nunca reescribe el pronóstico anterior.
4. El error es `IPC observado − mediana REM`, en puntos porcentuales, con la
   versión `rem-inflation-error-1.0.0`. Sólo se calcula para el mismo mes y
   unidad, con ambos datos conocidos al corte, y si la edición REM precede a la
   publicación del IPC. Un faltante o una incompatibilidad se muestran con
   motivo; no se convierten en cero.
5. La persistencia, la ingesta medida y la lectura de `/argentina` requieren
   sus propios controles de derechos, presupuesto y acceso personal antes de
   abrir red o publicar el bloque. Esta ADR no autoriza guardar el XLSX crudo ni
   mostrar datos REM en una URL pública.

## Consecuencias

El núcleo del parser y del error se puede probar sin Neon ni llamadas en las
pruebas. La fecha de publicación y el valor de un informe archivado sólo se
consideran defendibles con evidencia de esa edición, no por extrapolación del
calendario mensual. Una revisión posterior del archivo oficial no cambia una
consulta `as_known` anterior.
