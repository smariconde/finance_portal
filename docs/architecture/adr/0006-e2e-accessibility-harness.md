# ADR 0006: harness E2E y de accesibilidad

- Estado: aceptado
- Fecha: 2026-08-26
- Alcance: incorpora `@playwright/test`, `@axe-core/playwright` y `axe-core` como
  dependencias de desarrollo, y define qué prueba y qué no prueba el gate
- Decisiones relacionadas: [ADR 0004](0004-personal-first-runtime.md) define los
  modos que el gate verifica; [ADR 0005](0005-request-time-runtime-boundary.md)
  hace que un solo build alcance para probarlos

## Contexto

`F1-07` exige un recorrido automatizado del shell, de la corrida de referencia y
del runtime trabado, más evidencia reproducible de teclado, foco, mobile,
`prefers-reduced-motion` y un chequeo de accesibilidad. `F1-06` cerró dejando esa
medición como follow-up de `UI-02`: se ejecutó a mano porque no había navegador
disponible en la sesión del agente.

Tres afirmaciones del contrato vigente sólo se pueden verificar sobre una página
realmente renderizada:

1. un runtime trabado no expone datos **ni nombres de valores de configuración** en
   el HTML servido (`TM-02`);
2. el mismo artefacto sirve o niega según el entorno del runtime (`TM-01`, `TM-04`,
   y ADR 0005);
3. foco visible, orden de tabulación, reflow a 390 px y feedback bajo movimiento
   reducido se comportan como `UI-02` y `UI-03` declaran.

Ninguna se puede probar en jsdom o happy-dom: no hay layout real, no hay viewport,
no hay `prefers-reduced-motion` y no hay servidor sirviendo un build.

## Decisión

### Playwright como runner E2E, sólo contra `127.0.0.1`

Se adopta `@playwright/test` con **un solo navegador**, Chromium. El harness
levanta dos servidores locales sobre el mismo build —uno con entorno `personal`,
otro `locked`— y navega contra ellos. No hay egress: el gate no alcanza ningún host
externo, igual que los unit y contract tests.

### `axe-core` como chequeo automatizado de accesibilidad

`@axe-core/playwright` corre sobre cada ruta, en ambos temas y ambos viewports. El
umbral que rompe el gate es cero findings `serious` o `critical`. Es un piso, no un
techo: axe no reemplaza la revisión de Impeccable ni el walkthrough de `F1-08`, y
así queda registrado en `docs/design/interface-foundations.md`.

### Reemplaza a los scripts `live` de Impeccable, que siguen sin aprobarse

`.impeccable/config.json` mantiene hooks, edición en vivo, llamadas de red,
generación de imágenes y self-update deshabilitados. Este harness es la alternativa
revisada para obtener evidencia renderizada: su código vive en el repositorio, se
lee en el diff y no ejecuta nada que el owner no haya leído. Aprobar Playwright no
aprueba los scripts `live`.

### Regla de capturas

Una captura sólo se comitea si proviene de un runtime cuyo contenido es sintético o
es la negativa del runtime trabado. **Nunca se comitea una captura tomada sobre
datos reales del owner**, ni siquiera parcial o recortada. Cuando `F2-*` conecte
fuentes reales, la evidencia visual de esas superficies se describe por escrito o se
toma sobre fixtures, y esta regla se vuelve a verificar en `F9-04`.

### El gate declara sus límites

El harness prueba comportamiento, no apariencia. No se adoptan snapshots de imagen
como aserción: en esta etapa producirían fallos por diferencias de renderizado de
fuentes entre máquinas y no expresan ningún contrato del producto. Las capturas se
generan como evidencia para leer, no como oráculo.

## Consecuencias

### Aceptadas

- `pnpm test:e2e` existe y por lo tanto puede anunciarse; `AGENTS.md`, `CLAUDE.md` y
  `README.md` dejan de declararlo planificado.
- `UI-02` se puede cerrar con medición reproducible en vez de una revisión manual.
- El gate corre en CI en un job propio, con Chromium instalado por Playwright y
  fijado por `pnpm-lock.yaml`.

### Costos

- Tres dependencias de desarrollo nuevas y un navegador de ~190 MB por entorno de
  CI. Se acota instalando sólo Chromium, no los tres motores.
- El gate depende de un build de producción, así que es el check más lento de la
  secuencia. Queda fuera de `pnpm test` a propósito: el bucle rápido no lo paga.
- Cobertura de un solo motor. Firefox y WebKit no están en alcance mientras el
  consumidor sea un único owner sobre un navegador conocido; ampliarlo es una
  decisión de `F9-03`, no una omisión olvidada.

## Alternativas descartadas

- **Vitest browser mode.** Reusa el runner que ya está, pero está pensado para
  componentes: montar el árbol no ejercita el servidor, los headers, el guard de
  modo ni la diferencia entre dos entornos sobre el mismo build, que es justamente
  lo que `F1-07` tiene que probar.
- **jsdom con `@testing-library`.** Sin layout no hay reflow, sin viewport no hay
  mobile y `prefers-reduced-motion` no existe. Probaría el marcado, no el contrato.
- **CDP a mano, como en `F1-UI-01`.** Ya se usó para medir, y funciona, pero cada
  aserción hay que escribirla contra el protocolo: no hay reintentos, ni aserciones
  con espera, ni reporte, ni proyectos por viewport. El costo de mantenerlo supera
  al de una dependencia estándar.
- **Habilitar los scripts `live` de Impeccable.** Requieren red y self-update, que
  `AGENTS.md` prohíbe por defecto, y su salida es una revisión asistida, no un gate
  que falle en CI.
