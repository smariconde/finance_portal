# Runbook: walkthrough del owner

- Slice: `F1-08` — cierre del gate de Fase 1
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
pnpm walkthrough
```

Compila una vez y sirve **ese mismo artefacto** desde dos servidores que sólo se
diferencian en su entorno:

| Servidor     |              URL | Entorno                                       | Resultado esperado                         |
| ------------ | ---------------: | --------------------------------------------- | ------------------------------------------ |
| personal     | `127.0.0.1:3120` | el `.env.local` real del owner, sin sustituir | sirve shell, diagnóstico y corrida         |
| sin declarar | `127.0.0.1:3121` | modo, acceso y `DATABASE_URL` vaciados        | queda trabado y no sirve superficie alguna |

Para iterar sin recompilar, cuando el build ya está hecho:

```bash
pnpm walkthrough --no-build
```

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

## Las tres tareas

### Tarea 1 — desktop, 1440×900

Entrar en `http://127.0.0.1:3120` y responder por escrito, sin salir del
navegador:

1. ¿Qué valor por acción produjo la corrida de referencia y en qué moneda?
2. ¿Sobre qué hechos reportados se apoya, con qué fecha de corte y qué
   antigüedad tiene cada uno?
3. ¿Qué se declaró ausente y con qué motivo? ¿Alguna ausencia se lee como cero?
4. ¿Qué pasa con el valor si el corte de conocimiento es el 2025-03-01 en vez del
   2025-06-01, y por qué son dos corridas y no una corrección?
5. ¿La página promete en algún lado una capacidad que el portal todavía no tiene?

Registrar: tiempo total, en qué paso hubo que volver atrás y qué término no se
entendió a la primera.

### Tarea 2 — mobile, 390×844

Con emulación de dispositivo, desde la misma sesión:

1. Llegar a la corrida de referencia usando la navegación, no la URL.
2. Leer la sensibilidad WACC/g: encontrar el caso base, una celda donde el valor
   cae y las celdas sin definir con su motivo.
3. Volver al diagnóstico de configuración y confirmar qué modo está activo.
4. Hacer el mismo recorrido sólo con teclado: `Tab`, `Enter`, `Escape`. El foco
   tiene que verse siempre y `Escape` tiene que cerrar lo que abrió.

Registrar: tiempo total, qué requirió scroll horizontal, qué texto quedó cortado
y en qué momento se perdió el foco.

### Tarea 3 — el entorno sin declarar

Abrir `http://127.0.0.1:3121` en la misma sesión y confirmar, ruta por ruta —`/`,
`/configuracion`, `/valuacion/referencia` y una ruta inexistente—:

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
runtime personal sobre datos reales**, ni recortadas. Hoy la única superficie con
contenido es sintética y declarada como tal, así que capturarla es seguro; cuando
`F2-*` conecte fuentes reales, un hallazgo sobre ellas se describe por escrito.

Cada hallazgo se clasifica antes de cerrar el slice:

- **issue**: entra al backlog con ID, criterio de aceptación y fase;
- **diferido**: se registra con motivo y condición de reingreso;
- **no es un hallazgo**: se anota igual, con la razón por la que se descartó.

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
