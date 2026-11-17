# Marca torii de Portal Financiero

- Estado: dirección aprobada por el owner el 2026-11-16.
- Modo: `Operate`; marca del shell, pestaña y acceso guardado.
- Decisión: opción B, sello marfil con torii bermellón y remate carbón.
- Maestro: `public/brand/portal-mark.svg`.
- Derivados: `public/brand/portal-mark-dark.svg` (inversa),
  `public/brand/portal-favicon.svg` (adaptativo),
  `public/favicon.ico` (16, 32 y 48 px) y
  `public/apple-touch-icon.png` (180 px).
- Regeneración: `node scripts/build-brand-assets.mjs`, con Sharp ya instalado.

## Concepto y procedencia

El torii representa un portal; sus dos pilares son velas japonesas y una tercera
vela ocupa el paso central. La combinación liga el nombre del producto con el
análisis financiero. El símbolo convive con el nombre «Portal Financiero», sin
renombrarlo ni modificar su alcance.

El owner propuso el torii y aportó una imagen como referencia de color. La
exploración se generó con la herramienta integrada `image_gen`, con fondo
transparente. El sello seleccionado se reconstruyó como geometría SVG: conserva
la composición aprobada y elimina la textura, los bordes irregulares y los
residuos de transparencia de la propuesta raster. La app sirve sólo recursos
locales; el render y la regeneración no consultan un modelo ni una red.

## Color y tamaño

| Rol                    | Color                      |
| ---------------------- | -------------------------- |
| Torii y velas del logo | `#EA3B18`                  |
| Remate                 | `#293638`                  |
| Disco                  | `#FFF8EF`                  |
| Interacción en claro   | `#A32F18`, texto `#FFFDF8` |
| Interacción en oscuro  | `#FF9A7D`, texto `#202A2B` |

La silueta es la misma en ambos temas. Por pedido del owner, la versión oscura
invierte carbón y marfil: disco carbón y remate marfil, con el torii bermellón
intacto. La sidebar sigue el tema efectivo, incluso cuando el owner fuerza un
tema distinto al sistema. El favicon SVG se adapta a la preferencia de color
del navegador; el ICO de respaldo y el ícono de Apple mantienen la versión clara. El shell hereda carbón y
neutros cálidos. El bermellón vivo se reserva para la imagen; el tono funcional
es más oscuro en claro para que enlaces, botones y hover conserven contraste.
Los colores de suba/baja, advertencia y error conservan su significado y texto.
Las paletas categóricas de los otros gráficos siguen siendo independientes.

El SVG se usa en la sidebar expandida (28 px) y colapsada (24 px). El enlace
conserva su nombre accesible; la imagen interior es decorativa. El favicon ICO
contiene tres tamaños, con el SVG como opción escalable. El disco no recibe
sombras, textura, borde añadido ni animación.

## Prompt de la variante elegida

La segunda imagen era el torii del owner, como referencia de color; el sello
azul previo era el objetivo de edición.

```text
Use case: logo-brand, color refinement of the selected logo.
Input images: the earlier blue circular seal with white torii/candlestick symbol is the EDIT TARGET. The user's simple red torii with a charcoal upper cap on white is a COLOR REFERENCE ONLY.
Preserve the selected seal's exact concept, proportions and structure: circular disc, upswept torii upper lintel, shorter crossbeam, two outer posts formed as financial candlestick bodies with lower wicks, plus one small standalone financial candlestick centered in the passage. Preserve the financial candlestick integration. Do not replace it with the reference's ordinary torii.
Style: meticulously clean flat vector-like identity artwork. All color fills completely uniform. Smooth precise edges, balanced generous negative spaces, strong silhouette. No gradients, texture, grain, speckles, glow, shadows, 3D or perspective. No text, letters, border labels, extra shapes or watermark.
Composition: one centered standalone circular emblem on a square canvas, about 82 percent canvas width, even clear margin. Genuinely transparent background OUTSIDE the disc. The disc and interior symbol are fully opaque.
The reference red is a warm saturated Japanese torii vermilion, approximately #EA3B18, NOT burgundy, magenta, pink or neon red. Charcoal reference approximately #293638.
Color arrangement B: the disc is solid warm ivory #FFF8EF. The torii, its lower crossbeam, its two financial-candlestick posts and the central financial candlestick are solid warm VERMILION #EA3B18. Only the torii's curved uppermost lintel is solid CHARCOAL #293638, echoing the dark cap in the user's reference. Three opaque colors only: warm ivory disc, vermilion symbol, charcoal upper lintel. No outline around the disc. This is a clear circular seal, not a free-standing gate or a square background. Preserve the selected logo's candle bodies and wicks.
```
