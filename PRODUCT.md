# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El usuario principal es el owner del portal: un inversor argentino que investiga
empresas globales accesibles mediante CEDEAR, compara fundamentales, construye
valuaciones y sigue el régimen macroeconómico local. Desde la Fase 11 también
opera su cuenta de Schwab (day trade y swing) y lleva acá el plan, el diario y
el riesgo de esos trades. Usa el producto como una herramienta recurrente de
investigación y decisión, nunca para enviar órdenes ni para publicar
recomendaciones.

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
- No hay demo pública: fuera de un runtime personal la app se traba y no sirve
  datos ([ADR 0004](docs/architecture/adr/0004-personal-first-runtime.md)).
- Arriba de todo, Inicio y el **Calendario** de la bolsa de Nueva York en hora
  de Buenos Aires. Después, dos secciones. **Análisis**: valuación por ticker con su
  ficha, matrices de riesgo y divergencias por sector, y el tablero argentino
  con la soja. **Trading**: cuenta Schwab en vivo, plan antes de la rueda,
  diario con estadísticas y lecciones. No incluye un screener general: el
  filtrado amplio se hace con Finviz, al que el plan arma links.
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
- Quedan fuera de alcance la ejecución de órdenes —la conexión con Schwab es
  de sólo lectura y la app de Schwab tiene _Order Limit_ 0
  ([ADR 0076](docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md))—,
  custodia, recomendaciones personalizadas, cuentas, roles, multi-tenancy, BYOK
  y una app móvil nativa.
- No se agregan analytics de terceros por defecto y los secretos permanecen
  server-only.

## Brand Commitments

- Nombre de producto: Portal Financiero.
- Idioma principal: español, con formatos de datos `es-AR`.
- La voz es precisa, sobria, explicable y educativa; separa hechos,
  transformaciones, supuestos y opinión.
- La dirección visual confirmada es un workspace financiero estándar,
  `shadcn-first`: navegación, controles, cards, tablas y estados deben resultar
  familiares antes que novedosos.
- El sistema usa Base UI, tokens semánticos, radios moderados, densidad numérica
  legible y bermellón funcional sobre carbón y neutros cálidos. La marca es un sello torii con velas japonesas, aprobado por el owner el 2026-11-16. La personalidad vive en el
  contenido financiero, el locale `es-AR` y la provenance, no en una composición
  experimental.
- La identidad evita los clichés de interfaces generadas por IA y fintech: neón,
  gradientes decorativos, vidrio, icon tiles, píldoras excesivas y estética de
  terminal de trading. También evita rails ornamentales, titulares de landing y
  patrones propios cuando un componente shadcn conocido resuelve mejor la tarea.
- Debe mostrarse que la información es educativa y no constituye asesoramiento
  financiero, sin usar esa advertencia como excusa para reducir la calidad.

## Evidence on Hand

- El alcance, los flujos, las reglas financieras, la arquitectura y el roadmap
  están documentados en `docs/finance-portal-masterplan/`.
- `README.md` presenta públicamente la propuesta, el estado real y el contrato de
  ejecución del proyecto.
- La aplicación sirve datos reales del owner: fundamentales de la SEC, precios,
  CEDEAR, valuaciones con su snapshot, series del BCRA y del INDEC, la cuenta
  Schwab y sus transacciones. El estado de cada slice está en
  `docs/backlog/README.md`.
- La marca propia está documentada en `docs/design/portal-brand.md`. No hay testimonios, clientes, benchmarks públicos, licencia de
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
