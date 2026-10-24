# Runbook: walkthrough del owner

- Slice: `F6-06` — reingreso del walkthrough diferido de `F1-08`
- Depende de: [ADR 0004](../architecture/adr/0004-personal-first-runtime.md) y
  [ADR 0005](../architecture/adr/0005-request-time-runtime-boundary.md)
- Complementa —no reemplaza— al
  [gate E2E y de accesibilidad](e2e-accessibility-gate.md)

## Qué mide y qué no

El gate de `F1-07` prueba mecánicamente que el runtime personal sirve, que el
trabado niega y que `axe-core` no encuentra findings `serious` ni `critical`.
Nada de eso dice si el producto **se entiende**.

Este walkthrough mide lo otro: cuánto tarda el owner en obtener una respuesta,
dónde duda, qué lee mal y qué esperaba encontrar y no estaba. Su salida no es un
exit code sino un registro con hallazgos, y cada hallazgo termina como issue del
backlog o como diferimiento con motivo.

No es una demo ni una revisión visual libre. Son tres tareas fijas, cronometradas,
sobre una sesión limpia.

## Cómo se levanta la sesión

```bash
pnpm walkthrough --ticker AAPL
```

Compila una vez y sirve **ese mismo artefacto** desde dos servidores que sólo se
diferencian en su entorno:

| Servidor     |              URL | Entorno                                       | Resultado esperado                         |
| ------------ | ---------------: | --------------------------------------------- | ------------------------------------------ |
| personal     | `127.0.0.1:3120` | el `.env.local` real del owner, sin sustituir | sirve shell, diagnóstico y corrida         |
| sin declarar | `127.0.0.1:3121` | modo, acceso y `DATABASE_URL` vaciados        | queda trabado y no sirve superficie alguna |

Para iterar sin recompilar, cuando el build ya está hecho:

```bash
pnpm walkthrough --no-build --ticker AAPL
```

`--ticker` elige la empresa del recorrido (AAPL por defecto); valida el símbolo,
pero no confirma su pertenencia al universo ni crea una corrida. El owner la
pide desde la interfaz. Pedir una valuación puede descargar datos y llamar a la
IA bajo los presupuestos existentes; abrir una corrida guardada sólo lee.

Los puertos son 3120 y 3121 —no los 3110/3111 del gate E2E— así que las dos
cosas pueden convivir. `Ctrl+C` corta ambos servidores.

### Por qué el servidor personal no se fabrica

El harness del gate le inyecta al servidor personal una `DATABASE_URL` que no
escucha y centinelas en lugar de secretos, porque ahí lo que se prueba es la
frontera. Acá se prueba el producto: el walkthrough tiene que correr sobre el
runtime que el owner **realmente tiene**, incluido su `.env.local`. Si ese
entorno no alcanza para `personal`, eso ya es el primer hallazgo y hay que
registrarlo antes de seguir.

### Por qué mobile es emulación y no un teléfono

Ambos servidores escuchan sólo en `127.0.0.1`. Exponer a la red local un runtime
que sirve datos reales para poder abrirlo desde un teléfono contradice la
frontera de la ADR 0004, y ningún hallazgo de legibilidad justifica abrir esa
puerta. La tarea mobile se hace con emulación de dispositivo a 390×844.

Límite declarado: la emulación no reproduce el teclado virtual, el gesto de
volver del sistema operativo ni el rendimiento real del dispositivo. Lo que ese
límite deje afuera queda para `F10-06`.

### Qué cuenta como sesión limpia

- Ventana privada nueva, sin extensiones activas.
- Sin estado previo de la sidebar, el tema ni el scroll.
- Sin el código abierto al lado: la tarea se resuelve leyendo la interfaz. Si hay
  que abrir un archivo para contestar, eso es el hallazgo.
- Cronómetro arrancado antes de abrir la primera URL.

## Sesión remota de F6-06

Aplicar primero el [procedimiento de despliegue protegido](protected-deployment.md).
Registrar el commit del deployment y el mismo ticker para todo el recorrido.
Las tareas 1 y 2 usan su origen remoto con la sesión de Vercel del owner. No hace
falta levantar el harness local para esas dos tareas.

La tarea 3 comprueba dos fronteras distintas: el artefacto local sin declarar,
con `pnpm walkthrough --no-build --ticker AAPL` sobre ese mismo commit, y cada host
remoto en una ventana privada sin sesión de Vercel ni bypass. La plataforma debe
interceptar esas visitas antes de entregar la aplicación. Autenticado, confirmar
que el owner sí puede entrar. Registrar ambos resultados por separado; una
negativa local no prueba la protección remota.

## Las tres tareas

### Tarea 1 — desktop, 1440×900

Entrar en el origen personal (local `http://127.0.0.1:3120` o remoto protegido)
y resolver desde la interfaz, sin abrir el código:

1. Llegar a Valuación, escribir el ticker elegido y seguir el estado hasta una
   corrida o una negativa con motivo. Separar tiempo de espera del tiempo de
   lectura. Un ticker sin datos suficientes no cumple la tarea de leer un valor:
   registrar la negativa y repetir con una empresa que sí tenga corrida.
2. ¿Qué valor por acción, moneda, método y nivel de rigor declara? ¿Cómo se
   compara con el precio guardado, y de qué día es ese precio?
3. ¿Qué hechos, fechas y fuentes sostienen el resultado? ¿Cómo distingue hechos,
   reglas, propuestas de IA y ausencias? ¿Alguna ausencia se entiende como cero?
4. ¿Cuál es el rango bear/base/bull y qué driver cambia? Si tiene CEDEAR, ¿cuál
   es su ratio, valor USD y valor ARS o motivo de ausencia? ¿El CCL se entiende
   como una relación entre cierres diarios, no como una cotización simultánea?
5. Consultar el historial y recargar la página sin pedir otra corrida. ¿Se
   conserva el corte y se entiende qué cambió respecto del pedido anterior?
   ¿Se distingue de «Volver a valuar», que puede bajar datos, pedir IA y guardar
   otra corrida? No ejecutar un refresco adicional sólo para contestar.
6. ¿Qué capacidad promete la página que no entrega? Anotar controles marcados
   para revisión y faltantes en vez de tratarlos como una valuación cerrada.

Registrar: tiempo total, en qué paso hubo que volver atrás y qué término no se
entendió a la primera.

### Tarea 2 — mobile, 390×844

Con emulación de dispositivo, desde la misma sesión:

1. Llegar a la corrida real del ticker usando la navegación, no la URL.
2. Leer la sensibilidad WACC/g: encontrar el caso base, una celda donde el valor
   cae y las celdas sin definir con su motivo.
3. Volver al diagnóstico de configuración y confirmar qué modo está activo.
4. Hacer el mismo recorrido sólo con teclado: `Tab`, `Enter`, `Escape`. El foco
   tiene que verse siempre y `Escape` tiene que cerrar lo que abrió.

Registrar: tiempo total, qué requirió scroll horizontal, qué texto quedó cortado
y en qué momento se perdió el foco.

### Tarea 3 — el entorno sin declarar

Abrir `http://127.0.0.1:3121` en la misma sesión y confirmar, ruta por ruta —`/`,
`/configuracion`, `/valuacion`, `/valuacion/<ticker>`, `/valuacion/referencia`
y una ruta inexistente—:

1. Ninguna sirve datos ni una versión reducida de ellos.
2. La negativa explica qué falta de forma accionable, y nombra variables sin
   mostrar ningún valor.
3. La navegación sigue existiendo: el runtime trabado no deja al owner sin salida.

Registrar: si en algún punto pareció una demo o un error en vez de una negativa
deliberada.

Este servidor vacía las variables en lugar de borrarlas del archivo del owner:
una variable declarada vacía recorre exactamente la misma rama de fallo cerrado.
El caso de la variable **verdaderamente ausente** ya está cubierto por
`src/server/persistence/runtime-composition.test.ts`, que prueba los cinco
selectores contra seis entornos trabados.

## Plantilla de registro

El registro se guarda en `docs/walkthroughs/<fecha>-<slice>.md` a partir de
[la plantilla](../walkthroughs/TEMPLATE.md), y su resumen entra como evidencia
del issue en [el backlog](../backlog/README.md) y como fila del registro de
sesiones del roadmap.

Regla de hallazgos, heredada de la ADR 0006: **no se capturan pantallas del
runtime personal sobre datos reales**, ni recortadas. Describir los hallazgos
por escrito, sin payloads, snapshots privados, credenciales, cookies ni bypasses.
Guardar la identificación detallada del deployment en el registro privado de
operación y sólo su referencia segura en el repositorio.

Cada hallazgo se clasifica antes de cerrar el slice:

- **issue**: entra al backlog con ID, criterio de aceptación y fase;
- **diferido**: se registra con motivo y condición de reingreso;
- **no es un hallazgo**: se anota igual, con la razón por la que se descartó.

El registro declara `F6-06` pendiente mientras falte la prueba remota, el replay
o la sesión cronometrada del owner. Preparar esta plantilla no es ejecutar el
walkthrough ni cerrar la fase.

Un walkthrough que no produce hallazgos es un resultado válido y también se
registra. Lo que no vale es cerrarlo sin el registro.

## Fallas seguras

- **Puerto ocupado.** El servidor termina y el harness corta con código 1
  nombrando los dos puertos, en vez de dejar la sesión corriendo contra un
  artefacto viejo.
- **Build fallido.** El script sale con el código del build y no levanta nada.
- **El servidor personal arranca trabado.** No es una falla del harness: es el
  primer hallazgo. Anotarlo, revisar `.env.local` contra `.env.example` y
  reiniciar la sesión limpia desde cero, porque el cronómetro ya no vale.
