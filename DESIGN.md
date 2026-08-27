---
name: "Portal Financiero"
description: "Workspace financiero familiar para investigación reproducible y trazable."
colors:
  background: "oklch(0.985 0.002 247.84)"
  foreground: "oklch(0.205 0.012 258.34)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.205 0.012 258.34)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.205 0.012 258.34)"
  primary: "oklch(0.488 0.177 255.73)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.961 0.006 247.86)"
  secondary-foreground: "oklch(0.28 0.018 256.85)"
  muted: "oklch(0.961 0.006 247.86)"
  muted-foreground: "oklch(0.52 0.024 257.42)"
  accent: "oklch(0.94 0.025 252.57)"
  accent-foreground: "oklch(0.31 0.087 255.66)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.91 0.012 255.51)"
  input: "oklch(0.91 0.012 255.51)"
  ring: "oklch(0.58 0.145 255.66)"
  sidebar: "oklch(0.972 0.004 252.89)"
  sidebar-foreground: "oklch(0.27 0.018 256.85)"
  sidebar-primary: "oklch(0.488 0.177 255.73)"
  sidebar-primary-foreground: "oklch(0.985 0 0)"
  sidebar-accent: "oklch(0.925 0.024 252.63)"
  sidebar-accent-foreground: "oklch(0.31 0.087 255.66)"
  sidebar-border: "oklch(0.91 0.012 255.51)"
  sidebar-ring: "oklch(0.58 0.145 255.66)"
typography:
  headline:
    fontFamily: '"Archivo Variable", "Segoe UI", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: '"Archivo Variable", "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
    letterSpacing: "normal"
  body:
    fontFamily: '"Archivo Variable", "Segoe UI", sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    letterSpacing: "normal"
  body-large:
    fontFamily: '"Archivo Variable", "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    letterSpacing: "normal"
  label:
    fontFamily: '"Archivo Variable", "Segoe UI", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
    letterSpacing: "normal"
rounded:
  sm: "calc(0.75rem * 0.6)"
  md: "calc(0.75rem * 0.8)"
  lg: "0.75rem"
  xl: "calc(0.75rem * 1.35)"
  2xl: "calc(0.75rem * 1.7)"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  6: "1.5rem"
  8: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 0.625rem"
    height: "2rem"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 0.625rem"
    height: "2rem"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.25rem 0.625rem"
    height: "2rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  alert:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 0.625rem"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "2rem"
    padding: "0.125rem 0.5rem"
    height: "1.25rem"
  sidebar-item-active:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.sidebar-accent-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.5rem"
    height: "2rem"
  table:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.5rem"
---

# Design System: Portal Financiero

## Overview

**Creative North Star: "Workspace financiero familiar"**

Portal Financiero es un workspace operativo, sobrio y reconocible. La interfaz usa convenciones estándar de software financiero —sidebar, header compacto, cards, tablas, campos y estados explícitos— para que el owner pueda orientarse sin aprender una gramática propia. La personalidad aparece en el contenido financiero en español, la densidad numérica y la provenance visible, no en una composición experimental.

El sistema trabaja con neutrales fríos, blanco para superficies contenidas y azul para interacción. La jerarquía es corta, los controles son compactos y los radios moderados. El modo claro y el oscuro conservan los mismos roles semánticos; la información importante nunca depende sólo del color.

**Key Characteristics:**

- Shell estándar con sidebar colapsable, drawer mobile y header compacto.
- Cards, alertas y tablas convencionales con bordes o rings suaves.
- Azul funcional sobre neutrales sobrios, con color de estado siempre acompañado por icono y texto.
- Archivo Variable en toda la interfaz y numerales tabulares para datos comparables.
- Profundidad progresiva: respuesta, estado, provenance y detalle permanecen conectados.
- Densidad legible en escritorio y reflow directo en mobile.

## Colors

La paleta es semántica: fondos y superficies neutrales sostienen el trabajo; el azul identifica interacción y los colores de estado sólo califican información explícita.

### Primary

- **Azul funcional** (`colors.primary`): acciones primarias, iconos de énfasis y señales interactivas. Su foreground garantiza contraste en controles rellenos.

### Neutral

- **Fondo de workspace** (`colors.background`): lienzo continuo detrás del shell y del contenido.
- **Texto principal** (`colors.foreground`): títulos, valores y lectura prioritaria.
- **Superficie de card** (`colors.card`): agrupación convencional de una decisión o bloque de información.
- **Superficie secundaria** (`colors.muted`): filas activas suaves, código, placeholders y fondos auxiliares.
- **Texto secundario** (`colors.muted-foreground`): contexto, metadata y explicaciones.
- **Borde suave** (`colors.border`): separación entre regiones, filas y controles.
- **Sidebar neutral** (`colors.sidebar`): plano persistente de navegación, separado del contenido sin contraste teatral.

### Tertiary

- **Destructivo** (`colors.destructive`): errores o acciones destructivas; no se usa para variación financiera ordinaria.
- **Estados de disponibilidad:** verde para `ready`, ámbar para `degraded`, neutral para `disabled` y azul para `planned`. Son tratamientos implementados en `StatusMark`, no nuevos tokens globales.

**The Functional Blue Rule.** El azul señala acción, selección o información planificada; no se distribuye como decoración.

**The State Is Never Color Alone Rule.** Cada estado combina color con icono y etiqueta legible.

## Typography

**Display Font:** Archivo Variable (con Segoe UI y sans-serif como fallback)

**Body Font:** Archivo Variable (con Segoe UI y sans-serif como fallback)

**Label Font:** Archivo Variable (con Segoe UI y sans-serif como fallback)

**Character:** Una sola familia sans variable mantiene continuidad entre navegación, lectura y cifras. El contraste surge de peso, tamaño y color semántico; no existe una voz editorial separada ni una tipografía display ornamental.

### Hierarchy

- **Headline** (`typography.headline`): título de página en mobile; sube a `1.875rem` desde el breakpoint `md` sin cambiar de carácter.
- **Title** (`typography.title`): títulos de cards, secciones y decisiones operativas.
- **Body** (`typography.body`): densidad principal para tablas, controles, descripciones y navegación.
- **Body Large** (`typography.body-large`): introducciones de página en pantallas medianas o mayores.
- **Label** (`typography.label`): metadata, fases, estados y rótulos compactos.

La clase utilitaria `.numeric` aplica numerales tabulares y alineados a valores comparables. El código de configuración conserva una voz monoespaciada sólo para nombres técnicos.

**The Numbers Align Rule.** Los valores comparables usan numerales tabulares antes de recibir cualquier énfasis cromático.

**The Short Hierarchy Rule.** Una página usa un único `h1`, títulos de card sobrios y texto secundario; no introduce titulares de landing dentro del workspace.

## Layout

El shell ocupa el viewport completo. En escritorio, la sidebar mide `16rem` expandida y `3rem` colapsada; desde `md` (`48rem`) permanece lateral. En mobile se convierte en un drawer de `18rem`. El header sticky mide `3.5rem` y mantiene trigger, identidad compacta y estado operativo en la primera línea.

El contenido se centra en un máximo de `80rem`, con padding de `1rem`, `1.5rem` desde `md` y `2rem` desde `lg` (`64rem`). Las páginas usan una columna principal con gaps de `1.5rem`; los resúmenes pasan a tres columnas desde `md`, y las composiciones asimétricas sólo entran cuando el ancho `xl` (`80rem`) las sostiene. El footer es discreto y se apila en mobile.

Las tablas conservan semántica nativa y overflow horizontal. Los grids se apilan; no se comprimen valores, estados o provenance hasta volverlos ilegibles. Los targets principales del menú mobile y el trigger llegan a `2.75rem`.

**The Familiar First Rule.** Sidebar, header, cards, tablas y formularios siguen convenciones shadcn/Base UI antes de crear un patrón propio.

**The Wide Content Scrolls Rule.** Una tabla ancha conserva columnas, encabezados y desplazamiento horizontal; no reduce texto y cifras hasta perder legibilidad.

## Elevation & Depth

El sistema es plano por defecto y separa niveles mediante color semántico, borde y ring. Las cards usan un ring de `1px` con el foreground al `10%`; no flotan. La sidebar se distingue por su propio neutral y borde. El drawer mobile es la excepción estructural: usa overlay tenue y `shadow-lg` para comunicar modalidad. El header sticky puede usar transparencia y blur leve para conservar legibilidad al desplazar contenido, nunca como vidrio decorativo.

**The Containment Before Elevation Rule.** Borde, ring y superficie resuelven la agrupación cotidiana; la sombra se reserva para overlays y paneles modales.

## Shapes

La raíz de radios es `0.75rem`. Controles estándar usan el radio `lg`; elementos compactos derivan `md` o `sm`; las cards usan `xl`. Los badges de estado son cápsulas compactas porque agrupan icono y etiqueta en una sola unidad reconocible. Los bordes son finos y los iconos Lucide mantienen una geometría simple.

**The Moderate Radius Rule.** El sistema usa esquinas suaves y consistentes: ni radios cero como identidad ni contenedores excesivamente redondeados.

**The Pill Has a Role Rule.** Las cápsulas pertenecen a badges y estados breves; botones, campos, cards y bloques de contenido conservan radios moderados.

## Components

Las primitivas son componentes shadcn editables construidos sobre Base UI. Se reutilizan antes de introducir una nueva abstracción visual.

### Buttons

- **Shape:** radio `lg`, texto `0.875rem` medium y altura base de `2rem`; las variantes compactas bajan a `1.75rem` o `1.5rem`.
- **Primary:** fondo azul funcional, texto de contraste y hover por reducción de opacidad.
- **Outline:** fondo del workspace, borde semántico y hover sobre muted.
- **Focus / Active:** borde ring más halo de `3px`; el estado activo desplaza `1px` vertical cuando no abre un popup.
- **Disabled:** bloquea interacción y usa opacidad al `50%`.

### Inputs

- **Style:** altura de `2rem`, radio `lg`, borde input y fondo transparente en claro.
- **Focus:** borde ring más halo de `3px` al `50%`.
- **Disabled / Invalid:** fondo input atenuado y opacidad al `50%`; invalid usa destructive con halo, nunca sólo color.

### Badges & Status

- **Badge:** altura de `1.25rem`, tipografía de `0.75rem`, cápsula compacta y borde opcional.
- **StatusMark:** variantes `ready`, `degraded`, `disabled` y `planned`; cada una incluye icono Lucide, etiqueta y tratamiento claro/oscuro.
- **Usage:** disponibilidad y modo operativo, no metadata arbitraria.

### Cards / Containers

- **Corner Style:** radio `xl`.
- **Background:** card semántica con texto card-foreground.
- **Boundary:** ring suave de `1px`; no sombra en reposo.
- **Internal Padding:** `1rem` por defecto y `0.75rem` en cards pequeñas.
- **Usage:** una decisión, resumen o bloque real por card; las filas internas usan divisores cuando comparten contexto.

### Alerts

- **Style:** grid compacto, borde, radio `lg` y padding de `0.5rem 0.625rem`.
- **Meaning:** icono, título y descripción explican alcance o condición operativa.
- **Color:** el fondo azul suave usado en la home es informativo y contextual, no una variante decorativa universal.

### Tables

- **Structure:** tabla semántica de ancho completo dentro de un contenedor con overflow horizontal.
- **Density:** headers de `2.5rem`; celdas con `0.5rem` de padding y contenido sin wrap por defecto.
- **State:** divisores horizontales y hover muted al `50%`; filas seleccionadas usan muted.
- **Financial data:** valores comparables usan `.numeric`; estado y provenance viajan en columnas explícitas.

### Data marks

Implementadas en `src/app/valuacion/referencia/_components/data-marks.tsx`.

- **Purpose:** `StatusMark` califica la disponibilidad de una capacidad; las data marks califican la naturaleza de un dato. Son dimensiones distintas y no se mezclan: si no, “listo” significa dos cosas en la misma página.
- **Families:** estado de corrida (`Calculada`, `Requiere revisión`, `Rechazada`), naturaleza del dato (`Hecho reportado`, `Supuesto`, `Ausencia declarada`), estado de claim y antigüedad (`Vigente`, `Envejecido`, `Vencido`, `Posterior a la valuación`).
- **Anatomy:** icono Lucide, etiqueta legible y prefijo `sr-only` que nombra la dimensión calificada. La antigüedad agrega su distancia en días como cifra tabular.
- **Color:** verde, ámbar, rosa, azul y neutral sólo acompañan al icono y al texto; nunca son el único canal.
- **Secondary text on a tinted badge:** la distancia en días se distingue por **peso**, nunca por opacidad. Un `opacity-80` sobre las superficies ámbar y esmeralda bajaba ese texto por debajo de 4.5:1 y lo detectó el gate de `F1-07`. Sobre una superficie teñida, atenuar no es un canal disponible.

### Sensitivity matrix

Implementada en `src/app/valuacion/referencia/_components/sensitivity-matrix.tsx`.

- **Structure:** tabla semántica con `th scope="col"` por parámetro horizontal y `th scope="row"` por parámetro vertical; `caption` declara unidad, moneda, rango y paso de ambos ejes.
- **Encoding:** el importe se escribe en la celda. El tinte —`color-mix(in oklab, var(--chart-1) N%, var(--card))`— ordena las celdas de menor a mayor y no comunica nada por sí solo.
- **Ramp:** intensidades `0 / 6 / 11 / 16 / 22 %`, asignadas por **posición en el orden** y no por rango lineal, para que un escenario extremo no aplaste al resto. El tope de `22 %` es un valor medido: más tinte baja el texto de delta por debajo de 4.5:1 en tema claro. Cambiarlo obliga a volver a medir.
- **Undefined cells:** una celda fuera del modelo declara `No definido` con su motivo; no queda vacía, no cae a cero y no hereda el valor vecino.
- **Base case:** la celda que reproduce el caso base se marca con `ring` y etiqueta. Cuando el snapshot no la contiene, no se marca ninguna y la página lo explica.

### Navigation

- **Desktop:** sidebar de `16rem`, colapsable a iconos de `3rem`; shortcut `Ctrl/Cmd+B` y tooltips cuando está colapsada. El rail de arrastre queda fuera del árbol de accesibilidad: duplicaba el nombre del trigger sin agregar ninguna capacidad para teclado o lector de pantalla.
- **Mobile:** drawer lateral de `18rem`; al elegir una ruta se cierra, y `Escape` lo cierra. Los tooltips **no** existen en este ancho: son una afordancia de puntero, y su trigger capturaba `Escape` antes de que llegara al drawer.
- **Items:** altura base de `2rem`, radio `md`, icono de `1rem`; activo y hover usan sidebar-accent. Un ítem no disponible usa `aria-disabled`, no `disabled`, para conservar su tooltip —única etiqueta cuando la sidebar está colapsada— y seguir anunciándose como no accionable.
- **Information architecture:** Inicio, Valuación y Configuración enlazan. Valuación lleva el badge `Ref` porque su ruta corre el motor sobre un snapshot fijo para verificar que el cálculo es reproducible, no para mostrar datos de una empresa. Las herramientas sin datos aparecen deshabilitadas con la etiqueta `Plan`.

### Shell

- **Header:** sticky, compacto y separado por borde; contiene trigger, nombre, descriptor y estado del modo.
- **Skip link:** oculto fuera de foco y visible al navegar por teclado.
- **Footer:** advertencia educativa y descripción del modo sin competir con el contenido.
- **Motion:** sidebar y drawer usan transiciones cortas; `prefers-reduced-motion` reduce sus duraciones a `0.01ms` y desactiva smooth scroll.

### Refusal surfaces

Dos superficies dicen que no: `RuntimeLockedNotice`, cuando el entorno no probó ser privado, y la 404 en `src/app/not-found.tsx`. Comparten forma a propósito, para que una negativa se reconozca como tal.

- **Shape:** una sola card dentro de `max-w-3xl`, con `h1` en el título e icono Lucide inline.
- **Content:** qué pasó, por qué, y la única acción que saca del estado. La negativa nombra la configuración faltante por nombre y nunca por valor; la 404 no adivina un destino ni ofrece una búsqueda que el portal todavía no puede resolver.
- **Not a reduced product.** Ninguna de las dos muestra una versión recortada de lo que habría detrás. Un estado de error que parece funcionar es cómo se pasa por alto una configuración equivocada.

**The Evidence Travels With the Result Rule.** Fuente, fecha, unidad, moneda, transformación y estado permanecen junto al resultado que explican.

**The Card Has a Job Rule.** Una card agrupa una decisión o bloque real; no envuelve cada línea, etiqueta o gráfico por decoración.

**The Fact and the Assumption Are Never Interchangeable Rule.** Un hecho reportado, un supuesto del modelo y una ausencia declarada llevan marcas distintas y no comparten tabla. Un valor faltante nunca aparece como un cero.

**The Tint Is Measured Rule.** Un fondo teñido que sostiene texto declara su contraste medido sobre los tokens de ambos temas. El valor va escrito; el color sólo lo refuerza.

## Do's and Don'ts

### Do:

- **Do** empezar con primitivas shadcn/Base UI existentes y sus variantes implementadas.
- **Do** usar azul para interacción y mostrar estados con icono, texto y color.
- **Do** mantener numerales tabulares, fechas, unidades, moneda y provenance junto a los datos.
- **Do** conservar el shell compacto, los gutters responsivos y el overflow horizontal de tablas.
- **Do** usar cards para agrupaciones reales y divisores para filas relacionadas dentro de una misma card.
- **Do** revisar tema claro y oscuro, teclado, foco, reflow y `prefers-reduced-motion`.

### Don't:

- **Don't** recuperar la “Mesa de calibración”, el rail editorial, titulares de landing o registros lineales como identidad del producto.
- **Don't** imponer radios cero ni oponerse a cards, badges o patrones shadcn convencionales.
- **Don't** usar gradientes decorativos, neón, vidrio, blur ambiental, icon tiles o estética de terminal de trading.
- **Don't** convertir cada etiqueta o control en una píldora; resérvala para badges y estados breves.
- **Don't** usar color como único canal de estado ni presentar capacidades planificadas como disponibles.
- **Don't** separar un resultado financiero de su fecha, unidad, moneda, fuente o transformación.
