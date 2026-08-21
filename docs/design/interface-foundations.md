# Interface foundations and evidence

- Estado: reconciliado para Fase 0B.6
- Fecha: 2026-08-21
- Superficie implementada: home `/`
- Modo de interacción: `Operate`
- Dirección: `Mesa de calibración`
- Tracker de deuda: [`../backlog/README.md`](../backlog/README.md#cobertura-de-deuda-transversal)

## Propósito

Este documento evita tratar cualquier mockup, screenshot o sidecar generado como una
fuente de verdad accidental. Registra qué interfaz existe, cómo se adapta, dónde viven
los tokens y qué deuda sigue abierta antes de reutilizar el sistema en Fase 1.

No autoriza rutas futuras ni presenta el shell actual como producto funcional. La home
es un wireframe ejecutable con health real y estados honestos; búsqueda, datos,
valuaciones y proveedores siguen sin implementar.

## Orden de autoridad

1. [`../product/prd.md`](../product/prd.md), roadmap y contratos financieros definen
   verdad, alcance, estados y contenido.
2. [`../../DESIGN.md`](../../DESIGN.md) es la fuente normativa del lenguaje visual y
   sus roles semánticos.
3. [`.impeccable/surfaces/src-app-page-tsx.md`](../../.impeccable/surfaces/src-app-page-tsx.md)
   define exclusivamente la composición de la home.
4. [`src/app/globals.css`](../../src/app/globals.css) implementa los tokens y layouts
   vigentes; no crea por sí solo una decisión reusable.
5. [`.impeccable/design.json`](../../.impeccable/design.json) es un sidecar derivado
   para herramientas. No se edita como sustituto de `DESIGN.md`.
6. [`src/app/page.tsx`](../../src/app/page.tsx) es la evidencia ejecutable. Una
   captura ayuda a revisar, pero no reemplaza código, brief ni contrato.

Si dos niveles discrepan, se corrige primero el nivel normativo apropiado y después su
derivado. No se “sincroniza” copiando ciegamente CSS generado hacia el brief.

## Wireframe ejecutable

### Escritorio

```text
┌──────────────────────────────────────────────────────────────┐
│ marca                 navegación                   modo real │
├───────┬────────────────────────────┬─────────────────────────┤
│ rail  │ tesis / propósito          │ búsqueda deshabilitada  │
│ PIT   │                            │ + explicación honesta   │
├───────┼──────────────────────────────────────────────────────┤
│ rail  │ registro lineal de preguntas y estado planificado   │
├───────┼──────────────────────────────────────────────────────┤
│ rail  │ health de configuración: estado, lectura, faltantes  │
├───────┼──────────────────────────────────────────────────────┤
│ rail  │ contrato de evidencia: fuente, fecha, unidad, método │
└───────┴──────────────────────────────────────────────────────┘
│ disclaimer y límite personal/demo                            │
└──────────────────────────────────────────────────────────────┘
```

### Mobile

```text
marca + modo
escala PIT horizontal
tesis
búsqueda deshabilitada + motivo
registro de preguntas en bloques etiquetados
health con encabezados repetidos por fila
evidencia en secuencia de una columna
disclaimer
```

Los cortes implementados son `64rem` para colapsar navegación/columnas auxiliares y
`46rem` para el reflow móvil. El rail calibrado es firma de la home, no una plantilla
obligatoria para company research, valuación, matrices, series o macro.

## Cobertura de superficies

| Superficie       | Estado                          | Evidencia                                                     | Próxima decisión válida                                         |
| ---------------- | ------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| home `/`         | wireframe ejecutable            | page, CSS, surface brief y revisión desktop/mobile registrada | Fase 1 convierte navegación/estados en shell sin inventar datos |
| shell y health   | arquitectura visual documentada | `DESIGN.md` + home                                            | definir surface brief al comenzar Fase 1                        |
| empresa/screener | arquetipo, no wireframe         | `DESIGN.md`: company research                                 | diseñar sólo en su slice con datos/estados reales               |
| valuación        | arquetipo, no wireframe         | `DESIGN.md`: valuation workbench                              | diseñar después del motor y DTO aprobados                       |
| divergencias     | arquetipo, no wireframe         | `DESIGN.md`: matrix explorer                                  | exigir tabla accesible y negativos/outliers reales              |
| Argentina/series | arquetipo, no wireframe         | `DESIGN.md`: macro overview/time-series                       | definir por bloque y fechas heterogéneas                        |

No existen wireframes route-specific para esas rutas futuras. Esta ausencia es
intencional: evita fijar una UI antes de conocer el contrato de datos y el gate.

## Reconciliación de tokens

| Familia         | Fuente normativa                                                                   | Implementación actual                                         | Estado                                                             |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| color claro     | 17 roles semánticos en frontmatter de `DESIGN.md`                                  | mismos nombres y valores en `:root`                           | alineado                                                           |
| color oscuro    | remapeo semántico en `DESIGN.md`/sidecar                                           | mismos 17 roles bajo `prefers-color-scheme: dark`             | alineado                                                           |
| tipografía      | Archivo Variable + mono para coordenadas; roles display/headline/title/body/labels | familia, numerales tabulares y roles principales presentes    | parcial: falta una escala de pasos compactos reusable              |
| espaciado       | `xs`, `sm`, `md`, `lg`, `xl`, `section`, `page-gutter`                             | gutter/sections implementados; varios espacios siguen locales | parcial: promover sólo patrones repetidos en Fase 1                |
| forma/elevación | radio cero, reglas y superficies planas, sin sombras                               | CSS sin card shadows, blur ni radios decorativos              | alineado                                                           |
| breakpoints     | `64rem` y `46rem`                                                                  | mismos media queries                                          | alineado                                                           |
| movimiento      | calibración única y subrayado funcional                                            | `900ms` y `420ms`; reduce-motion global                       | parcial: reemplazar el kill global al introducir feedback stateful |
| componentes     | wordmark, nav, analysis field, states, registers y evidence fields                 | home implementa esos patrones                                 | alineado para home; no universalizar                               |

La duplicación de valores entre `DESIGN.md`, sidecar y CSS es deliberada sólo mientras
el sistema es pequeño. Si Fase 1 agrega componentes compartidos, la extracción debe
crear tokens de runtime nombrados y una prueba o script de comparación; no mantener
tres copias manuales crecientes.

## Auditoría Impeccable de baseline

El 2026-08-21 se ejecutó una única pasada estática:

```text
node .agents/skills/impeccable/scripts/detect.mjs --json \
  src/app/page.tsx src/app/layout.tsx src/app/globals.css
```

### Audit health

| Dimensión                |     Score | Evidencia principal                                                                                     |
| ------------------------ | --------: | ------------------------------------------------------------------------------------------------------- |
| Accessibility            |       3/4 | landmarks, labels, focus visible, estados con texto y reflow; falta auditoría browser/teclado repetible |
| Performance              |       4/4 | Server Components, fuente local, cero charts/imágenes/client bundle en la home                          |
| Responsive               |       3/4 | dos cortes explícitos y tabla que refluye; falta walkthrough automatizado persistente                   |
| Theming                  |       3/4 | roles claro/oscuro alineados; escala tipográfica compacta incompleta                                    |
| Implementation integrity |       3/4 | mundo coherente y específico; detector reportó 14 advisories de tamaño tipográfico                      |
| **Total**                | **16/20** | **Good: base coherente con deuda acotada**                                                              |

El detector no encontró hallazgos blocking o major. Sus 14 advisories pertenecen a una
sola familia: tamaños literales fuera de los siete roles tipográficos del frontmatter.
No se silencian con ignores. Antes de extraer componentes en Fase 1 se debe elegir una
de dos opciones y registrarla en `DESIGN.md`:

1. promover los pasos compactos realmente repetidos a una escala estable; o
2. normalizar CSS hacia los roles existentes cuando la diferencia no tenga intención.

### Hallazgos rastreados

| ID      | Severidad | Estado    | Hallazgo / cierre                                                                                                       |
| ------- | --------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `UI-01` | P2        | `done`    | Los rótulos del registro se alinearon con las Fases 2, 3, 4 y 6 del roadmap en `src/app/page.tsx`.                      |
| `UI-02` | P2        | `pending` | Falta evidencia reproducible de teclado/contraste; `F1-07` agrega E2E y `F1-08` conserva el walkthrough desktop-mobile. |
| `UI-03` | P2        | `pending` | `F1-01` debe reemplazar el kill global de movimiento antes de introducir feedback stateful.                             |
| `UI-04` | P3        | `pending` | `F1-01` consolida los 14 tamaños al extraer el shell sin expandir la escala por cada literal.                           |

`UI-01` se cerró al crear el tracker; `UI-02` a `UI-04` permanecen separadas del
diagnóstico hasta que el slice visual indicado adopte los componentes.

## Reglas para el siguiente cambio visual

1. Leer `PRODUCT.md`, `DESIGN.md`, este contrato y el surface brief de la ruta.
2. Elegir el modo por superficie; la app operativa usa `Operate`, documentación usa
   `Read` y una futura presentación pública podría usar `Persuade`.
3. Crear un brief route-specific antes de escribir una composición nueva.
4. Usar datos/estados del slice real; no crear controles muertos o números ambiguos.
5. Ejecutar una pasada desktop/mobile, corregir en lote y confirmar como máximo una
   vez más.
6. Registrar contraste, teclado, reflow y alternativa tabular cuando haya gráficos.
7. Actualizar `DESIGN.md` sólo para decisiones durables y este archivo sólo cuando
   cambie la topología de evidencia o la cobertura de superficies.
