# Runbook: gate E2E y de accesibilidad

- Autoridad: [ADR 0006](../architecture/adr/0006-e2e-accessibility-harness.md)
- Depende de: [ADR 0005](../architecture/adr/0005-request-time-runtime-boundary.md),
  que hace que un solo build alcance para probar los dos modos
- Slice: `F1-07`

## Qué prueba

Un solo `next build` servido por **dos servidores locales** que sólo se
diferencian en su entorno:

| Servidor | Puerto | Entorno                                         | Resultado esperado                 |
| -------- | -----: | ----------------------------------------------- | ---------------------------------- |
| personal |   3110 | `APP_MODE=personal`, acceso `local`, pooled URL | sirve shell, diagnóstico y corrida |
| trabado  |   3111 | `APP_MODE=locked`, sin `DATABASE_URL`           | niega toda superficie de datos     |

Que el mismo artefacto responda distinto es la prueba de que el modo se resuelve
en el request y no en el build (`TM-01`, `TM-04`).

Sobre esos servidores corren seis proyectos: escritorio 1440×900 en tema claro y
oscuro, ancho de teléfono 390×844, y un proyecto con
`prefers-reduced-motion: reduce`. Cada uno cubre shell y navegación, la corrida de
referencia, la negativa del runtime trabado, un scan de `axe-core` con umbral cero
en `serious` y `critical`, y la captura de evidencia.

## Cómo se corre

```bash
pnpm test:e2e
```

Compila una vez y después ejecuta Playwright. Acepta los argumentos del runner:

```bash
pnpm test:e2e --project=locked-desktop
pnpm test:e2e --grep "runtime trabado"
```

Para iterar sin recompilar, cuando el cambio es sólo del test:

```bash
pnpm exec playwright test --project=personal-mobile
```

La primera vez hay que instalar el navegador. Es lo único que el gate descarga:

```bash
pnpm exec playwright install chromium
```

## Requisitos

- **No necesita PostgreSQL.** Ninguna superficie de este slice abre la base. El
  servidor personal recibe una `DATABASE_URL` que apunta a un puerto donde no
  escucha nada, así que si alguna ruta empezara a consultar la base el gate
  fallaría en vez de pasar en silencio.
- **No necesita `.env.local`.** El harness fija las variables que le importan en
  el proceso de cada servidor, y `@next/env` no pisa una variable ya declarada.
  Compilar en la máquina del owner no contamina la corrida.
- **No abre red.** `NEXT_TELEMETRY_DISABLED=1` se fija en el build y en los dos
  servidores; los tests sólo navegan a `127.0.0.1`.

## Evidencia que produce

Capturas de página completa en `.impeccable/review/`, nombradas
`<proyecto>-<ruta>.png`. El directorio está en `.gitignore`: son evidencia para
leer en la máquina del owner, no un artefacto del repositorio ni un oráculo del
test.

Regla que las hace seguras, de la ADR 0006: **sólo se captura un runtime cuyo
contenido es sintético o la negativa del runtime trabado**. Nunca una captura
sobre datos reales del owner, ni siquiera recortada. Cuando `F2-*` conecte fuentes
reales, esas superficies se describen por escrito o se capturan sobre fixtures.

Ante un fallo, Playwright guarda traza y captura en `tests/e2e/.output/`:

```bash
pnpm exec playwright show-trace tests/e2e/.output/<carpeta>/trace.zip
```

## Fallas seguras

- **Puerto ocupado.** Los servidores se levantan con `reuseExistingServer: false`,
  así que un `next start` olvidado en 3110 o 3111 hace fallar el arranque en vez
  de correr los tests contra un artefacto viejo.
- **Build fallido.** `scripts/run-e2e.ts` corta antes de levantar los servidores y
  devuelve el código de salida del build.
- **Finding de accesibilidad.** El mensaje nombra la regla de axe y el selector
  del nodo. Un finding es un defecto del producto hasta que se demuestre lo
  contrario: no se sube el umbral para pasar el gate.
- **Sin navegador.** Playwright falla nombrando la versión de Chromium que espera;
  se resuelve con `playwright install chromium`, no ajustando el test.

## Qué no cubre

- Un solo motor. Firefox y WebKit quedan para `F10-06`.
- Ninguna comparación de imágenes: las capturas se leen, no se afirman.
- `axe-core` es un piso mecánico. No evalúa jerarquía de lectura, calidad del copy
  ni si una tabla dice algo verdadero; la revisión de Impeccable y el walkthrough
  de `F1-08` siguen siendo necesarios.
