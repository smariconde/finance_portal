# Walkthrough `<ID>` — `<fecha>`

- Protocolo: [runbook del walkthrough](../runbooks/owner-walkthrough.md)
- Build: `<commit>`
- Slice: `F6-06` (reingreso de `F1-08`)
- Ticker: `<símbolo>`
- Deployment: `<referencia al registro privado, sin URL ni tokens>`
- Entorno personal: modo efectivo `<personal | locked>`, acceso `<local | protected>`
- Navegador y versión: `<...>`
- Sesión limpia: `<sí | no, con motivo>`

## Tarea 1 — desktop 1440×900

- Tiempo: `<mm:ss>`
- Espera del job / lectura: `<mm:ss / mm:ss>`
- Resultado: `<completada | completada con ayuda | no completada>`

| Pregunta                             | Respuesta obtenida | Dónde la encontró | Dudas |
| ------------------------------------ | ------------------ | ----------------- | ----- |
| Valor por acción y moneda            |                    |                   |       |
| Hechos, corte y antigüedad           |                    |                   |       |
| Ausencias y motivo                   |                    |                   |       |
| Precio de mercado y su fecha         |                    |                   |       |
| Método y rigor                       |                    |                   |       |
| Escenarios y acceso CEDEAR           |                    |                   |       |
| Historial y diferencia con refrescar |                    |                   |       |
| Capacidad prometida y no provista    |                    |                   |       |

## Tarea 2 — mobile 390×844

- Tiempo: `<mm:ss>`
- Resultado: `<completada | completada con ayuda | no completada>`

| Paso                       | Resultado | Observación |
| -------------------------- | --------- | ----------- |
| Llegar por navegación      |           |             |
| Leer la sensibilidad       |           |             |
| Confirmar el modo activo   |           |             |
| Recorrido sólo con teclado |           |             |

## Tarea 3 — entorno sin declarar

| Ruta                    | Sirve datos | Negativa accionable | Navegación disponible |
| ----------------------- | ----------- | ------------------- | --------------------- |
| `/`                     |             |                     |                       |
| `/configuracion`        |             |                     |                       |
| `/valuacion`            |             |                     |                       |
| `/valuacion/<ticker>`   |             |                     |                       |
| `/valuacion/referencia` |             |                     |                       |
| ruta inexistente        |             |                     |                       |

### Protección remota

- Fecha, commit y hosts: `<referencia al registro privado>`
- Vercel Authentication / All Deployments confirmado: `<sí | no>`
- Ventana privada sin sesión ni bypass: `<la plataforma intercepta cada ruta y host | falla>`
- Sesión del owner autorizado: `<accede | falla>`
- Excepciones y bypasses revisados: `<resultado, sin valores>`
- Job remoto completo y replay: `<resultado y referencia privada>`

## Hallazgos

| #   | Descripción | Superficie | Severidad | Clasificación | Destino |
| --- | ----------- | ---------- | --------- | ------------- | ------- |
| 1   |             |            |           |               |         |

Severidad: `bloqueante | confusión | fricción | cosmético`.
Clasificación: `issue | diferido | no es un hallazgo`.
Destino: ID del issue nuevo, o el motivo y la condición de reingreso.

## Conclusión

- Tareas completadas sin ayuda: `<n/3>`
- Gate `F6-06`: `<pasa | no pasa | pendiente>`, con motivo
- Próximo slice: `<...>`
