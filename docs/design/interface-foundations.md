# Interface foundations and evidence

- Estado: implementado para `F1-UI-01`, extendido por `F1-06` y con la revisión renderizada automatizada en `F1-07`
- Fecha: 2026-08-21, extendido el 2026-08-25, automatizado el 2026-08-26
- Superficies implementadas: home `/`, configuración `/configuracion`, corrida de referencia `/valuacion/referencia`, 404 `not-found`, negativa del runtime trabado y shell compartido
- Modo de interacción: `Operate`
- Dirección: `Workspace financiero estándar`
- Canon: `shadcn-finance-20260821`
- Tracker: [`../backlog/README.md`](../backlog/README.md#f1-ui-01--fundación-shadcn-y-migración-visual)

## Propósito

Este contrato evita que una portada experimental o un screenshot aislado se conviertan
en la plantilla accidental del producto. El portal usa convenciones conocidas de
software financiero: sidebar colapsable, header compacto, tarjetas de resumen,
tablas semánticas, estados explícitos y profundidad progresiva.

La familiaridad es una decisión de producto. El carácter surge de la calidad de la
información —unidades, fechas, provenance, comparabilidad y densidad numérica—, no de
inventar controles o geometrías propias.

## Orden de autoridad

1. [`../product/prd.md`](../product/prd.md), roadmap y contratos financieros definen
   verdad, alcance, estados y contenido.
2. [`../../PRODUCT.md`](../../PRODUCT.md) fija los compromisos de marca y el uso
   `shadcn-first` solicitado por el usuario.
3. [`../../DESIGN.md`](../../DESIGN.md) define tokens, componentes y reglas durables.
4. Los briefs de [home](../../.impeccable/surfaces/src-app-page-tsx.md),
   [configuración](../../.impeccable/surfaces/src-app-configuracion-page-tsx.md),
   [corrida de referencia](../../.impeccable/surfaces/src-app-valuacion-referencia-page-tsx.md)
   y [404](../../.impeccable/surfaces/src-app-not-found-tsx.md)
   definen la composición de cada superficie.
5. [`../../src/app/globals.css`](../../src/app/globals.css), `src/components/ui/` y
   las páginas son la evidencia ejecutable.

Un sidecar o screenshot ayuda a revisar, pero no reemplaza estos niveles de autoridad.

## Baseline implementado

| Área        | Decisión                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Componentes | shadcn CLI con primitivas Base UI editables en `src/components/ui/`                                     |
| Navegación  | sidebar colapsable en escritorio y drawer en mobile; sólo Inicio y Configuración son rutas activas      |
| Layout      | header de 3.5rem, contenido máximo de 80rem, gutters responsivos y footer discreto                      |
| Superficies | fondo neutral, cards blancas con borde/ring suave, radio base de 0.75rem y sin glass/gradientes         |
| Color       | azul funcional para interacción; verde, ámbar y neutral sólo para estados acompañados por icono y texto |
| Tipografía  | Archivo Variable local; escala operativa fija y numerales tabulares para datos comparables              |
| Estado      | `ready                                                                                                  | degraded | disabled | planned` mediante badge, icono y etiqueta; nunca sólo color |
| Responsive  | grids apilan, sidebar pasa a drawer y las tablas anchas conservan scroll horizontal                     |
| Movimiento  | transiciones propias de componentes; `prefers-reduced-motion` reduce animación y scroll                 |

## Wireframe de referencia

### Escritorio

```text
┌──────── sidebar ────────┬───────────────────────────────────────────┐
│ marca / workspace       │ header compacto                  modo     │
│ Inicio                  ├───────────────────────────────────────────┤
│ Configuración           │ título + contexto                         │
│                         │ alerta operativa                          │
│ Herramientas plan       │ resumen en 3 métricas                     │
│                         │ cards / tabla / evidencia según la tarea  │
│ modo                    │                                           │
└─────────────────────────┴───────────────────────────────────────────┘
```

### Mobile

```text
┌─────────────────────────┐
│ menú  Portal       modo │
├─────────────────────────┤
│ título + contexto       │
│ alerta                  │
│ métricas apiladas       │
│ contenido en una col.   │
│ tabla con scroll        │
└─────────────────────────┘
```

## Componentes y límites

- Reutilizar `Button`, `Input`, `Badge`, `Alert`, `Card`, `Table`, `Sidebar`,
  `Sheet`, `Tooltip`, `Separator` y `Skeleton` antes de crear una primitiva nueva.
- Las cards agrupan una decisión o bloque real; no encapsulan cada línea, etiqueta o
  gráfico por decoración.
- Un control futuro se muestra deshabilitado sólo cuando explica por qué y cuándo se
  habilita. Las rutas planificadas no son enlaces.
- Fuente, fecha, unidad, moneda, transformación y estado viajan con el resultado.
- No hay charts decorativos en el shell o en la home. El primer chart real activa
  `financial-visualization-review` y usa Recharts/shadcn por defecto.
- ECharts o Canvas requieren un feature gap o presupuesto medido y permanecen
  route-local con carga diferida.

## Evidencia de `F1-UI-01`

| Gate                            | Resultado                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                     | pasa sin warnings                                                                                                          |
| `pnpm typecheck`                | pasa                                                                                                                       |
| `pnpm test`                     | 20/20 tests pasan, sin red                                                                                                 |
| `pnpm build`                    | pasa; `/` y `/configuracion` prerenderizan estáticamente                                                                   |
| Detector Impeccable             | `[]` sobre home, configuración, shell, sidebar, estados y CSS                                                              |
| Revisión browser desktop/mobile | no ejecutada: el navegador integrado rechazó la sesión por metadata de sandbox; no se sustituyó por automatización externa |

La ausencia de captura no se presenta como evidencia positiva. La inspección manual
desktop/mobile sigue siendo el follow-up de `UI-02`; cualquier hallazgo visual reabre
`F1-UI-01` antes de ampliar el sistema.

## Extensión de `F1-06`

`/valuacion/referencia` es la primera superficie con datos financieros reales del motor.
Hereda el shell, los tokens y las primitivas sin introducir un mundo visual nuevo,
y agrega dos patrones durables ya registrados en [`DESIGN.md`](../../DESIGN.md):
las **data marks** —que califican la naturaleza de un dato y no la disponibilidad
de una capacidad— y la **sensitivity matrix**, cuya rampa de tinte está medida en
vez de elegida a ojo.

| Gate                            | Resultado                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format:check`, `lint`          | pasan sin warnings                                                                                                                                                                                |
| `typecheck`                     | pasa                                                                                                                                                                                              |
| `test`                          | 282/282 unit tests, sin red                                                                                                                                                                       |
| `test:integration`              | 24/24 contra PostgreSQL `17.11`; el slice no toca schema ni repositorios                                                                                                                          |
| `build`                         | pasaba prerenderizando la ruta; desde la [ADR 0005](../architecture/adr/0005-request-time-runtime-boundary.md) se sirve en el request y esa fila queda corregida ahí                              |
| Detector Impeccable             | `[]` sobre la página, sus componentes, la sidebar y la home                                                                                                                                       |
| Contraste medido                | rampa de tinte y textos sobre celda calculados en oklab para ambos temas: peor caso 4.68:1 (delta) y 4.77:1 (caso base), sobre un floor de 4.5:1                                                  |
| Semántica verificada en el HTML | un solo `h1`, 10 `h2` y 8 `h3` sin salto de nivel; 7 tablas con 42 `th scope="col"` y 38 `th scope="row"`; 18 `<time datetime>`; 72 alternativas `sr-only`; celdas rechazadas legibles como texto |
| Revisión renderizada            | **no ejecutada**: no hay navegador disponible en la sesión y los scripts `live` de Impeccable no están aprobados por `AGENTS.md`. No se sustituyó por automatización externa                      |

El chequeo estático no reemplaza a la inspección renderizada a 1440×900 y 390×844.
Esa medición era el follow-up de `UI-02` y se ejecutó en `F1-07`.

## Cierre de `UI-02` en `F1-07`

La revisión renderizada dejó de depender de que alguien la ejecute: `pnpm test:e2e`
sirve un mismo build en modo personal y trabado, y recorre cada ruta en escritorio
1440×900 claro y oscuro, ancho de teléfono 390×844 y con `prefers-reduced-motion`.
Procedimiento en [`../runbooks/e2e-accessibility-gate.md`](../runbooks/e2e-accessibility-gate.md).

| Gate                 | Resultado                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `axe-core`           | 0 findings `serious` o `critical` en las 4 rutas × 6 proyectos, en ambos modos                                       |
| Teclado y foco       | skip link como primer destino, foco visible, sin trampas; el drawer mobile contiene el foco y lo devuelve al trigger |
| Reflow               | sin overflow horizontal del body en 1440×900 y 390×844 sobre las 4 rutas                                             |
| Movimiento reducido  | transición de la sidebar por debajo de 50 ms, sin smooth scroll, y el cambio de estado sigue siendo legible          |
| Capturas             | `.impeccable/review/<proyecto>-<ruta>.png`, regeneradas por el gate; sólo runtimes sintéticos o la negativa          |
| Revisión renderizada | **ejecutada y automatizada**; los scripts `live` de Impeccable siguen sin aprobarse                                  |

Tres hallazgos reales salieron de esta automatización y se corrigieron en el mismo
slice; los tres habían sobrevivido a la revisión manual de `F1-06`:

1. **Contraste.** La distancia en días de una data mark usaba `opacity-80` sobre
   ámbar y esmeralda y quedaba por debajo de 4.5:1. Ahora se distingue por peso.
2. **Estado no anunciado.** Las herramientas planificadas pasaban `disabled` a un
   `SidebarMenuButton` con tooltip, y el `TooltipTrigger` de Base UI consumía la
   prop sin reenviarla: el control se anunciaba como accionable y además perdía su
   tooltip. Ahora usan `aria-disabled`.
3. **`Escape` capturado.** En mobile cada ítem seguía siendo un tooltip trigger y su
   popup se quedaba con la tecla, así que el drawer no se podía cerrar por teclado
   más que tabulando hasta la X. Los tooltips ya no se montan en ese ancho.

Un cuarto ajuste salió del mismo recorrido: el rail de arrastre de la sidebar
duplicaba el nombre accesible del trigger sin agregar capacidad, y quedó fuera del
árbol de accesibilidad.

`axe-core` es un piso mecánico, no un certificado: no evalúa jerarquía de lectura,
calidad del copy ni si una tabla dice algo verdadero. El walkthrough del owner
(`F1-08`) y la auditoría WCAG 2.2 AA de `F9-03` siguen siendo necesarios.

## Reglas para el siguiente cambio visual

1. Leer `PRODUCT.md`, `DESIGN.md`, este contrato y el brief de la ruta.
2. Usar Impeccable antes de editar UI y `financial-visualization-review` cuando haya
   datos financieros visualizados.
3. Empezar por componentes shadcn existentes y justificar cualquier primitiva propia.
4. Usar datos y estados del slice real; no crear números ambiguos ni capacidades falsas.
5. Revisar desktop y mobile en lote, corregir y confirmar una vez más.
6. Registrar contraste, teclado, reflow, tooltip accesible y alternativa tabular al
   introducir gráficos.
7. Convertir una corrección repetible en candidato de mejora del skill; nunca dejar
   que el skill se autoedite sin autorización y evidencia.
