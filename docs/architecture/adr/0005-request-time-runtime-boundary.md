# ADR 0005: el modo efectivo se resuelve en request time

- Estado: aceptado
- Fecha: 2026-08-26
- Alcance: corrige **cómo se aplica** el límite definido por la
  [ADR 0004](0004-personal-first-runtime.md); no cambia qué significa cada modo
- Decisiones relacionadas: [ADR 0001](0001-stack-cache-postgres.md), que habilitó
  Cache Components

## Contexto

La ADR 0004 definió `locked | personal` como una frontera de seguridad: un runtime
que no puede probar que es privado no sirve datos. Las superficies preguntan por
`servesRealData()` y el resto llega hasta `selectPersonalDependency()`, que falla
cerrado.

Al preparar el gate automatizado de `F1-07` se midió el artefacto de build en vez
del código, y la frontera no estaba donde el contrato dice que está. Con
`cacheComponents: true` y sin ninguna API dinámica en el árbol, Next.js prerenderiza
las rutas durante `next build`. `getConfigHealth(process.env)` se evalúa entonces
**una sola vez, en la máquina que compila**, y su resultado queda escrito en el
HTML:

```
.next/server/app/index.html                → "Modo efectivo: personal"
.next/server/app/valuacion/referencia.html → la corrida completa, no la negativa
```

Ese build se produjo con el `.env.local` del owner. El mismo artefacto, servido por
un runtime con `APP_MODE=locked` y sin `DATABASE_URL`, sigue respondiendo
`personal` y sigue mostrando la corrida: el env del runtime no se lee nunca.

Hoy no se filtra nada, porque la única superficie con contenido es una fixture
sintética. El problema no es el dato actual sino la ubicación del control: un
predicado evaluado en build time no es una frontera de runtime, y `F2-*` conecta
fuentes reales sobre estas mismas rutas. Una página de datos prerenderizada
hornearía observaciones del owner dentro del artefacto de build, donde ningún
chequeo de modo posterior puede alcanzarlas.

## Decisión

### Toda lectura del modo efectivo ocurre durante el request

Se agrega un único punto de entrada server-only que espera `connection()` antes de
leer el entorno:

```ts
export async function getRequestConfigHealth(): Promise<ConfigHealth>;
```

`connection()` es la API de Next.js que declara "esto depende del runtime, no del
build". El layout y cada superficie que consulta el modo pasan a usarla; el
`getAppConfigHealth()` síncrono deja de existir para que no queden dos maneras de
preguntar lo mismo, una de ellas horneable.

### Las superficies que dependen del modo se vuelven dinámicas, a propósito

Con Cache Components, el acceso dinámico obliga a un límite `Suspense` o a que la
ruta se sirva entera en el request. Se elige lo segundo para las tres rutas
actuales: son pantallas de un portal de un solo usuario, sin tráfico que optimizar,
y una cáscara prerenderizada que después se rellena con la negativa es peor UX que
la negativa directa.

El costo es explícito y aceptado: estas rutas dejan de aparecer como estáticas en
la tabla de build. La corrida de referencia sigue calculándose en el proceso desde
un snapshot fijo, sin reloj, red ni base, así que su contenido sigue siendo
idéntico entre instalaciones; lo único que cambió es cuándo se decide si se sirve.

### El artefacto de build deja de ser portador del modo

Un `next build` ya no captura el modo de la máquina que compila. Compilar en el
entorno del owner y servir en otro produce la negativa, que es la respuesta
correcta.

## Consecuencias

### Aceptadas

- `TM-01` y `TM-04` pasan a probarse contra el artefacto servido y no contra el
  código fuente: el mismo build sirve datos bajo `personal` y los niega bajo
  `locked`. `F1-07` lo verifica con dos servidores y **un solo** build.
- Agregar una superficie de datos en `F2-*` no puede hornear observaciones del
  owner en el output de build.
- El harness E2E se simplifica: sin esto haría falta un build por modo.

### Costos

- Las rutas que consultan el modo dejan de prerenderizarse. La fila de evidencia de
  `F1-06` que afirmaba que `/valuacion/referencia` prerenderiza como estática queda
  corregida por una fila nueva en el registro de sesiones, no borrada.
- Un componente que quiera cachearse por debajo de estas rutas va a necesitar su
  propio `"use cache"` y su identidad de cache con el modo incluido, como ya exige
  la ADR 0004.

## Alternativas descartadas

- **Dejarlo como estaba y documentar "no publiques un build personal".** Convierte
  un control técnico en una regla de disciplina, sobre un repositorio público que
  cualquiera puede compilar y desplegar. Es exactamente el fallback silencioso que
  la ADR 0004 eliminó, movido de la resolución de modos al pipeline de build.
- **Un build por modo con `distDir` separado.** Mantiene el prerender y aísla los
  artefactos, pero duplica el tiempo de build, agrega una dimensión de
  configuración y deja intacto el problema de fondo: el artefacto sigue decidiendo
  algo que corresponde al runtime.
- **`export const dynamic = "force-dynamic"` por ruta.** Logra el mismo efecto pero
  como una marca que hay que recordar agregar en cada ruta nueva. `connection()`
  dentro del lector de configuración hace que la ruta se vuelva dinámica por
  preguntar por el modo, que es la propiedad que se quiere.
