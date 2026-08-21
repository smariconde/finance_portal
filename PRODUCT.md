# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El usuario principal es el owner del portal: un inversor argentino que investiga
empresas globales accesibles mediante CEDEAR, compara fundamentales, construye
valuaciones y sigue el régimen macroeconómico local. Usa el producto como una
herramienta recurrente de investigación y decisión, no para operar con velocidad
ni para publicar recomendaciones.

## Product Purpose

Portal Financiero reúne en una experiencia en español el trabajo que hoy exige
combinar filings, precios, ratios, instrumentos locales, supuestos de valuación y
contexto argentino en herramientas separadas.

El producto debe permitir encontrar una pregunta financiera, llegar a una
respuesta útil en menos de un minuto y entender de dónde proviene cada dato,
qué transformación recibió y qué supuestos explican el resultado. El éxito no es
predecir el mercado: es mejorar decisiones mediante análisis reproducible y
auditable.

## Positioning

La diferencia del portal es integrar análisis de compañías globales, acceso vía
CEDEAR, valuación determinista y contexto argentino bajo un mismo contrato de
evidencia point-in-time. Cada resultado importante conserva fuente, fecha,
unidad, moneda, disponibilidad, transformación y calidad; la IA puede proponer,
clasificar o explicar con evidencia, pero nunca reemplaza la aritmética
financiera.

## Operating Context

- La experiencia es mobile-first y también debe sostener análisis densos en
  escritorio.
- La instancia personal con datos reales se ejecuta en localhost o detrás de
  protección de plataforma.
- Una eventual URL pública funciona únicamente en modo demo con fixtures
  deterministas y sin credenciales.
- El flujo previsto abarca búsqueda y screener, ficha de empresa, divergencias
  fundamentales, valuación por escenarios, tablero argentino, metodología y
  salud de las fuentes.
- El repositorio público funciona también como portfolio técnico, sin exponer
  claves, base de datos ni payloads licenciados.

## Capabilities and Constraints

- El primer foco funcional es descubrir y analizar subyacentes accesibles por
  CEDEAR con datos auditables; divergencias, valuación, Argentina e IA se
  incorporan por slices verificados.
- Los valores faltantes permanecen como `null`; nunca se convierten
  silenciosamente en cero.
- Las fórmulas financieras son puras, deterministas, versionadas y cubiertas por
  tests, incluyendo casos de borde.
- Las consultas históricas respetan `available_at`, vintages y restatements para
  evitar look-ahead.
- Empresa, entidad legal, instrumento, listing, ticker y programa depositario son
  identidades distintas.
- La demo no presenta datos simulados como reales ni capacidades futuras como
  disponibles.
- Quedan fuera de alcance la ejecución de órdenes, conexión a brokers, custodia,
  recomendaciones personalizadas, tiempo real, cuentas, roles, multi-tenancy,
  BYOK y una app móvil nativa.
- No se agregan analytics de terceros por defecto y los secretos permanecen
  server-only.

## Brand Commitments

- Nombre de producto: Portal Financiero.
- Idioma principal: español, con formatos de datos `es-AR`.
- La voz es precisa, sobria, explicable y educativa; separa hechos,
  transformaciones, supuestos y opinión.
- La dirección visual confirmada es editorial financiera contemporánea: con
  carácter argentino, densidad organizada y el rigor de un informe de inversión
  excepcional.
- La identidad debe evitar los clichés de interfaces generadas por IA y de
  fintech: neón, gradientes decorativos, tarjetas flotantes repetitivas, exceso de
  píldoras y estética de terminal de trading.
- Debe mostrarse que la información es educativa y no constituye asesoramiento
  financiero, sin usar esa advertencia como excusa para reducir la calidad.

## Evidence on Hand

- El alcance, los flujos, las reglas financieras, la arquitectura y el roadmap
  están documentados en `docs/finance-portal-masterplan/`.
- `README.md` presenta públicamente la propuesta, el estado real y el contrato de
  ejecución del proyecto.
- La aplicación actual incluye el bootstrap técnico y una portada provisional;
  todavía no contiene datasets financieros, valuaciones, análisis persistidos ni
  funciones de IA.
- No hay aún logos, testimonios, clientes, benchmarks públicos, licencia de
  software, URL de producción ni claims de rendimiento que puedan usarse como
  prueba. El diseño no debe inventarlos.

## Product Principles

1. Evidencia antes que opinión: toda conclusión importante debe poder auditarse.
2. Una pregunta, una respuesta, su evidencia y luego el detalle.
3. Honestidad operativa: distinguir disponible, degradado, faltante y planificado.
4. Profundidad progresiva: lectura rápida primero, metodología y provenance a
   demanda.
5. Calma analítica: facilitar decisiones reflexivas sin urgencia artificial ni
   señales de compra o venta.

## Accessibility & Inclusion

- Objetivo WCAG 2.2 AA en temas claro y oscuro.
- Navegación completa por teclado, foco visible, targets táctiles suficientes y
  respeto por `prefers-reduced-motion`.
- Color, especialmente verde y rojo, nunca es el único canal para comunicar un
  estado o variación.
- Los gráficos deben contar con título, descripción y una tabla accesible
  equivalente; sus tooltips deben funcionar por foco o click, no solo por hover.
- El contenido debe conservar legibilidad y jerarquía en mobile, zoom y reflow.
