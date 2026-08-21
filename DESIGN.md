---
name: "Portal Financiero"
description: "Una mesa de calibración editorial para investigación financiera reproducible y trazable."
colors:
  paper: "#f2f4f1"
  paper-raised: "#fbfcfa"
  ink: "#142a31"
  ink-soft: "#506166"
  rule: "#aeb9b8"
  rule-strong: "#708084"
  blue: "#2b6f88"
  blue-deep: "#204f61"
  blue-soft: "#dcebef"
  signal: "#e7b43c"
  signal-soft: "#f6ebcb"
  critical: "#9f4038"
  critical-soft: "#f3dfdc"
  success: "#2f755f"
  success-soft: "#dcebe4"
  disabled: "#59676a"
  disabled-soft: "#e2e7e4"
  focus: "#146f92"
  selection: "#c9e4ec"
typography:
  display:
    fontFamily: '"Archivo Variable", "Arial Narrow", sans-serif'
    fontSize: "clamp(3rem, 6.8vw, 6rem)"
    fontWeight: 690
    lineHeight: 0.94
    letterSpacing: "-0.038em"
  headline:
    fontFamily: '"Archivo Variable", "Arial Narrow", sans-serif'
    fontSize: "clamp(2.1rem, 4vw, 4.25rem)"
    fontWeight: 660
    lineHeight: 1
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Archivo Variable", "Arial Narrow", sans-serif'
    fontSize: "clamp(1.15rem, 1.8vw, 1.55rem)"
    fontWeight: 640
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Archivo Variable", "Arial Narrow", sans-serif'
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  body-small:
    fontFamily: '"Archivo Variable", "Arial Narrow", sans-serif'
    fontSize: "0.83rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: '"Archivo Variable", "Arial Narrow", sans-serif'
    fontSize: "0.7rem"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "0.06em"
  mono-label:
    fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace'
    fontSize: "0.62rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.04em"
rounded:
  none: "0px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "clamp(4rem, 8vw, 8rem)"
  page-gutter: "clamp(1rem, 3.2vw, 3.5rem)"
components:
  wordmark-mark:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-label}"
    rounded: "{rounded.none}"
    height: "2rem"
    width: "2rem"
  navigation-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "1.45rem 0"
  analysis-field:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0.85rem 1rem"
    height: "3.4rem"
  planned-state:
    backgroundColor: "{colors.blue-soft}"
    textColor: "{colors.blue-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.36rem 0.48rem"
  register-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "1.5rem 0 1.65rem"
  health-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "1.2rem 0"
  status-ready:
    backgroundColor: "transparent"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  status-critical:
    backgroundColor: "transparent"
    textColor: "{colors.critical}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  evidence-cell:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "1rem 1rem 1.25rem 0"
---

# Design System: Portal Financiero

## Overview

**Creative North Star: "Mesa de calibración"**

Portal Financiero se comporta como un instrumento editorial de medición: cada cifra ocupa una posición clara, cada estado aparece junto al contenido que califica y cada resultado conserva su evidencia. La identidad combina la precisión de una mesa técnica con una voz financiera contemporánea, sobria y argentina. La densidad es organizada, no terminal; el carácter surge de la escala tipográfica, las reglas, las placas planas y el ritmo de registros.

El sistema rechaza el dashboard de tarjetas intercambiables. No busca dramatizar el mercado ni simular velocidad operativa: ordena preguntas, supuestos, series y provenance para una lectura reflexiva. La portada expresa este mundo con un rail calibrado y un registro lineal, pero esa composición pertenece a su surface brief y no debe convertirse en la plantilla universal de las herramientas.

**Key Characteristics:**

- Superficies minerales planas, divididas por reglas precisas.
- Jerarquía editorial amplia combinada con densidad numérica tabular.
- Azul para interacción y estructura; amarillo para evidencia destacada.
- Estados visibles inline, siempre acompañados por lenguaje o forma.
- Profundidad progresiva: pregunta, respuesta, evidencia y detalle.
- Movimiento corto y funcional que explica calibración o cambio de estado.

## Colors

La paleta se lee como papel, tinta y señalización técnica; el tema oscuro conserva los mismos roles semánticos mediante remapeo automático, sin convertir la experiencia en una terminal.

### Primary

- **Azul federal** (`colors.blue`): guía interacción, calibración y énfasis estructural; su variante profunda sirve para texto activo y hover, y la variante suave para fondos de estado.

### Secondary

- **Amarillo señal** (`colors.signal`): marca evidencia, unidades o referencias que necesitan distinguirse dentro de un campo oscuro. No funciona como decoración general.

### Tertiary

- **Rojo crítico** (`colors.critical`): comunica degradación o atención junto con texto y una marca geométrica.
- **Verde validado** (`colors.success`): comunica disponibilidad o validación junto con texto y una marca geométrica.

### Neutral

- **Papel mineral** (`colors.paper`): plano base continuo de la aplicación.
- **Papel elevado** (`colors.paper-raised`): variación tonal mínima para campos y controles; no implica una tarjeta flotante.
- **Tinta petróleo** (`colors.ink`): texto principal y campo inverso de evidencia.
- **Tinta secundaria** (`colors.ink-soft`): explicación, metadata y lectura secundaria.
- **Regla mineral** (`colors.rule`): separaciones internas de baja intensidad.
- **Regla estructural** (`colors.rule-strong`): límites de secciones, cabeceras y controles.
- **Neutral deshabilitado** (`colors.disabled`): estado no disponible, acompañado por texto explícito.

**The Signal Has Meaning Rule.** El azul dirige, el amarillo señala evidencia y rojo/verde califican estados; ningún acento se aplica por variedad visual.

**The State Is Never Color Alone Rule.** Todo estado combina color con etiqueta, forma o patrón legible sin color.

## Typography

**Display Font:** Archivo Variable (con Arial Narrow y sans-serif como fallback)  
**Body Font:** Archivo Variable (con Arial Narrow y sans-serif como fallback)  
**Label/Mono Font:** ui-monospace (con SFMono-Regular y Consolas como fallback)

**Character:** Una sola familia variable sostiene voz editorial y lectura compacta; el contraste proviene de peso, ancho óptico, escala y espaciado. La monoespaciada queda reservada para coordenadas, fases, unidades, configuración y provenance.

### Hierarchy

- **Display** (`typography.display`): tesis principales; bloque corto, balanceado y con ancho máximo controlado.
- **Headline** (`typography.headline`): encabezados de secciones y preguntas mayores.
- **Title** (`typography.title`): preguntas de registros y títulos operativos.
- **Body** (`typography.body`): explicación principal, con líneas cercanas a 48–61 caracteres cuando la composición lo permite.
- **Body Small** (`typography.body-small`): detalle denso, descripciones de filas y metadata explicativa.
- **Label** (`typography.label`): estados y rótulos compactos; puede usar mayúsculas sólo para vocabulario operativo breve.
- **Mono Label** (`typography.mono-label`): escalas, fechas, unidades, variables y coordenadas técnicas.

Los números usan cifras tabulares y alineadas en todo el documento para sostener comparaciones verticales.

**The Editorial–Instrument Split Rule.** Archivo formula preguntas y explicaciones; la monoespaciada identifica evidencia y coordenadas, nunca párrafos completos.

**The Numbers Align Rule.** Métricas comparables mantienen numerales tabulares y una alineación estable antes de recibir énfasis cromático.

## Layout

El lienzo es mobile-first y se expande hasta un ancho de contenido de 92rem. En escritorio, los márgenes fluidos y las columnas minmax sostienen tanto titulares amplios como registros densos. Las secciones se separan con reglas continuas y grandes pausas verticales; dentro de registros, el ritmo se comprime a filas de aproximadamente 1–1.65rem de padding vertical. Los cortes observados están en 64rem y 46rem: primero colapsan navegación y columnas auxiliares; después las tablas se convierten en bloques etiquetados, el rail cambia de vertical a horizontal y el padding lateral queda en 1rem.

Los layouts de ruta son arquetipos adaptables, no copias de la portada:

- **Company research:** identidad y disponibilidad arriba; fundamentales y evidencia en registros comparables; filings y transformaciones en profundidad progresiva.
- **Valuation workbench:** supuestos y resultados mantienen relación visible en escritorio y una secuencia inequívoca en mobile; escenarios se comparan con columnas o bandas, no con tarjetas desconectadas.
- **Matrix explorer:** el plano bidimensional prioriza encabezados estables, escalas legibles y una tabla accesible equivalente; el detalle se abre desde la celda o fila elegida.
- **Time-series analysis:** pregunta, ventana, unidad y fuente preceden al gráfico; el relato, la serie y su tabla accesible comparten el mismo contrato de evidencia.
- **Macro overview:** bloques editoriales por pregunta y régimen; evita una pared uniforme de gráficos y conserva transiciones, fechas y fuentes junto a cada lectura.

La portada conserva su rail calibrado, tesis amplia, entrada de análisis y registro lineal en `.impeccable/surfaces/src-app-page-tsx.md`; esos elementos no son requisitos de composición para otras rutas.

**The Question Shapes the Surface Rule.** La gramática visual es común, pero la estructura cambia según investigar una compañía, calibrar supuestos, explorar una matriz, leer una serie o entender un régimen.

**The Wide Becomes Explicit Rule.** En mobile, una tabla o matriz no se encoge hasta ser ilegible: refluye a bloques etiquetados o habilita desplazamiento con contexto persistente.

## Elevation & Depth

La elevación es plana y estructural. No hay sombras decorativas ni vidrio: la profundidad surge de reglas, campos tonales y secciones inversas. Un control puede usar un plano apenas más claro y una sección de evidencia puede invertir tinta y papel, pero ambos permanecen dentro del mismo tablero material.

**The Flat Instrument Rule.** Las superficies descansan en el plano; jerarquía y agrupación se construyen con borde, tono, espacio y contraste, nunca con sombras ambientales.

**The Inversion Means Evidence Rule.** Los campos oscuros se reservan para metodología, provenance o cierres de alta importancia, no para decorar módulos arbitrarios.

## Shapes

El lenguaje formal es ortogonal. Controles, placas, chips y marcadores no usan radios; las reglas de 1px y los acentos lineales de 2–3px forman la geometría dominante. Los cuadrados pequeños funcionan como marcas de estado y los ticks de calibración como notación instrumental. Cualquier futura visualización debe preferir ejes, bandas y contornos nítidos antes que cápsulas o blobs.

**The Honest Edge Rule.** Los componentes muestran su límite real: esquinas rectas, bordes visibles y sin recortes que sugieran flotación.

**The Pill Is Exceptional Rule.** No se usan píldoras para estados o filtros por defecto; una forma redondeada sólo entra si comunica una propiedad real del dato o la interacción.

## Components

Los componentes son instrumentos honestos, planos y precisos. El estado vive inline con el contenido y cada interacción mantiene foco visible.

### Navigation

- **Wordmark:** monograma cuadrado de 2rem con borde de tinta y nombre compacto; se reduce al monograma en mobile.
- **Links:** texto pequeño y sobrio sobre el papel base; el hover cambia a azul profundo sin desplazar el layout.
- **Mode indicator:** señal cuadrada más etiqueta en mayúsculas; informa el modo operativo, no funciona como badge decorativo.
- **Responsive:** la navegación central se oculta bajo 64rem, mientras marca y modo permanecen visibles.

### Analysis Field

- **Shape:** rectángulo sin radio, borde estructural y altura mínima de 3.4rem.
- **Surface:** papel elevado dentro del plano base; tecla o acción terminal separada por una regla vertical.
- **Focus:** contorno visible de 2px con offset de 3px en el shell completo.
- **Disabled:** conserva contraste y explica inline por qué la capacidad aún no está disponible.

### State Labels

- **Planned:** placa rectangular azul suave con borde azul, texto compacto en mayúsculas y sin sombra.
- **Ready / Critical / Disabled:** etiqueta textual junto a un cuadrado de estado; relleno, línea interior o tono distinguen cada condición además del color.

### Registers

- **Tool register:** filas lineales con metadata, pregunta, formato y estado; una línea azul de 2px recorre la base en hover o foco.
- **Health register:** tabla semántica en escritorio y bloques con pseudoencabezados visibles en mobile.
- **Density:** separación generosa entre grupos y padding contenido dentro de cada fila; no encapsular cada registro como tarjeta.

### Evidence Fields

- **Surface:** inversión tinta/papel para metodología y provenance de alta importancia.
- **Structure:** celdas divididas por reglas translúcidas, etiqueta monoespaciada amarilla y valor en Archivo.
- **Reading order:** fuente, fecha, unidad y transformación permanecen cerca del resultado que explican.

### Calibration Marks

El rail y sus ticks son una firma opcional del mundo, no un marco obligatorio. Pueden reaparecer como escala, cursor, umbral o anotación cuando exista una dimensión que realmente se esté midiendo. Su animación ocurre una vez y se desactiva bajo `prefers-reduced-motion`.

**The Inline Evidence Rule.** Fuente, fecha, unidad, transformación y estado se presentan donde se interpreta el dato; no se relegan a una nota genérica al pie.

## Do's and Don'ts

### Do:

- **Do** usar reglas continuas, placas tonales y espacio para expresar jerarquía antes de crear contenedores nuevos.
- **Do** elegir un arquetipo de layout según la pregunta financiera y adaptar su densidad al dispositivo.
- **Do** mostrar estado, fecha, unidad, moneda y fuente junto al contenido que califican.
- **Do** mantener foco visible, navegación por teclado, reflow legible y una tabla accesible equivalente para cada gráfico.
- **Do** reservar movimiento para calibración, orientación o cambio de estado y respetar `prefers-reduced-motion`.

### Don't:

- **Don't** construir grids de tarjetas intercambiables para métricas, herramientas o gráficos.
- **Don't** usar neón, gradientes decorativos, vidrio, sombras flotantes ni blur ambiental.
- **Don't** convertir cada estado, filtro o etiqueta en una píldora.
- **Don't** imitar una terminal de trading ni introducir urgencia visual, flashes o señales de compra/venta.
- **Don't** presentar capacidades futuras, datos simulados o valores faltantes como información real.
- **Don't** universalizar la composición de la home: su rail y registro pertenecen a esa superficie.
