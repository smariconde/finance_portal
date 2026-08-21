# Product requirements document

- Estado: aprobado para orientar la implementación incremental
- Versión: 0.1
- Fecha: 2026-08-21
- Owner: propietario único de la instancia
- Fuente de avance: [`../finance-portal-masterplan/06_PHASED_ROADMAP.md`](../finance-portal-masterplan/06_PHASED_ROADMAP.md)

## Propósito

Portal Financiero es una herramienta personal de investigación para un inversor
argentino. Integra análisis de empresas globales accesibles mediante CEDEAR,
fundamentales point-in-time, valuación determinista y contexto macroeconómico
argentino. Su resultado principal no es una señal de compra o venta: es una
respuesta reproducible con evidencia, supuestos y límites visibles.

El repositorio puede ser público. La instancia con datos reales pertenece a un
solo owner y se ejecuta en localhost o detrás de protección de plataforma. Una
URL pública anónima opera exclusivamente con fixtures deterministas.

## Problema

Responder una pregunta de inversión exige hoy combinar filings, precios,
identidad de instrumentos, ratios CEDEAR, supuestos de valuación y series
argentinas en herramientas separadas. Esa fragmentación dificulta:

- comprobar de dónde salió cada número y cuándo estaba disponible;
- comparar períodos sin mezclar monedas, unidades o bases de splits;
- distinguir cambios del negocio de recompras, dilución o expansión de múltiplos;
- reproducir una valuación después de cambiar datos o supuestos;
- saber si una fuente está vigente, degradada o fuera de cobertura.

## Usuario y contexto operativo

El usuario es el owner del portal. Investiga empresas globales, prioriza las que
tienen acceso mediante CEDEAR y necesita profundidad suficiente para revisar una
tesis sin operar con velocidad de trading.

No hay onboarding de terceros, perfiles, cuentas, roles, multi-tenancy ni BYOK.
Si el producto incorpora otros usuarios, datos live anónimos o recomendaciones
personalizadas, el cambio requiere una nueva revisión contractual, regulatoria y
de arquitectura antes de implementarse.

El brief visual que describe tono, marca y experiencia vive en [`../../PRODUCT.md`](../../PRODUCT.md).
Este documento define requisitos de producto; no reemplaza el roadmap ni el
sistema de diseño.

## Jobs to be done

1. **Encontrar:** filtrar empresas por calidad, crecimiento, deuda, valuación y
   disponibilidad mediante CEDEAR.
2. **Comparar:** observar cómo evolucionaron ventas, EPS, márgenes, market cap y
   acciones diluidas en dos o cinco años.
3. **Explicar divergencias:** separar crecimiento agregado, crecimiento por
   acción y efecto de recompras o dilución.
4. **Valorar:** elegir un método apropiado, editar supuestos y obtener escenarios
   y sensibilidad reproducibles.
5. **Interpretar Argentina:** revisar bloques nominales, monetarios, cambiarios,
   reales, fiscales, externos y agropecuarios con fechas heterogéneas explícitas.
6. **Auditar:** rastrear fuente, fecha, unidad, moneda, transformación, vintage y
   calidad de cada resultado material.

## Principios de producto

1. Evidencia antes que opinión.
2. Una pregunta, una respuesta, su evidencia y después el detalle.
3. Los estados `ready`, `degraded`, `disabled` y `planned` nunca se confunden.
4. Un faltante es `null` con motivo; no se convierte en cero.
5. Los cálculos financieros son deterministas, versionados y testeados.
6. Empresa, entidad legal, security, listing, ticker y programa depositario son
   identidades diferentes.
7. La UI no conoce payloads de proveedor ni llama proveedores durante el render.
8. La IA puede investigar, proponer o explicar; nunca ejecuta la aritmética.
9. Una demo pública no reutiliza datos capturados en modo personal.
10. Una capacidad futura se presenta como planificada, no como parcialmente
    funcional.

## Modos de ejecución

| Modo       | Destino                          | Datos                | Acciones permitidas                                                                              |
| ---------- | -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `demo`     | URL pública o local              | fixtures versionados | lectura y cálculos deterministas sobre fixtures; sin ingesta live, IA ni mutaciones persistentes |
| `personal` | localhost o deployment protegido | snapshots del owner  | integraciones y persistencia habilitadas únicamente cuando su fase y gate estén aprobados        |

La presencia de una variable o credencial no habilita una integración. Cada
frontera de red debe verificar el modo efectivo en servidor.

## Capacidades y requisitos funcionales

### Home y configuración

- Buscar por ticker, nombre de empresa o símbolo CEDEAR cuando el índice exista.
- Mostrar salud por módulo y distinguir configuración faltante de proveedor caído.
- Ofrecer accesos formulados como preguntas y estados honestos para módulos
  futuros.
- No mostrar análisis recientes hasta que exista persistencia real.

### Empresas y CEDEAR

- Filtrar un universo versionado por sector, CEDEAR, período y métricas
  compatibles con el sector.
- Mostrar valor actual, dos y cinco años sin forzar todas las columnas en mobile.
- Resolver identidad mediante IDs estables y tickers con vigencia.
- Historizar programas y ratios CEDEAR como fracciones exactas.
- Exportar sólo cuando el contrato de la fuente lo permita e incluir definiciones,
  fecha y provenance.

### Divergencias fundamentales

- Separar la vista agregada `net income vs market cap` de la vista por acción
  `EPS vs price`.
- Mostrar el cambio de acciones diluidas como puente explicativo.
- Clasificar extremos no positivos sin inventar un CAGR comparable.
- Mantener valores reales de outliers aunque la escala visual se recorte.
- No presentar un gap aislado como prueba de infravaloración.

### Valuación

- Seleccionar arquetipo y método mediante reglas deterministas.
- Mostrar datos faltantes antes de calcular.
- Separar supuestos operativos, reinversión, riesgo, terminales y ajustes.
- Permitir editar y bloquear supuestos antes de recalcular.
- Producir bear/base/bull, sensitivity, flujos, puente EV-equity, valor por acción
  y diagnósticos.
- Guardar un snapshot que pueda recalcularse con el mismo hash, engine y política
  numérica sin consultar una IA.
- Retornar `unsupported_method` cuando el método requerido no esté implementado.

### Argentina

- Organizar las series por pregunta y régimen, no como una pared de gráficos.
- Mostrar por serie fecha, frecuencia, unidad, revisión y transformación.
- Distinguir niveles, variaciones, series nominales/reales y ajustes estacionales.
- Explicar qué cambió, por qué importa y qué puede invalidar la lectura sin
  inventar causalidad.
- Para soja, identificar mercado, contrato, unidad, conversión y política de roll.

### Investigación asistida por IA

- Permanecer deshabilitada hasta la fase autorizada y siempre en modo `demo`.
- Usar evidencia identificada, salida estructurada y policy checks.
- Registrar modelo y proveedor efectivos, routing, parámetros, costo y política de
  datos.
- Abstenerse cuando falte evidencia y no sobrescribir supuestos bloqueados.

## Requisitos transversales

### Datos y trazabilidad

Toda observación material conserva fuente, identificador o URL, `as_of`,
`available_at`, `fetched_at`, período, unidad, moneda cuando aplique, valor raw y
normalizado, estado del raw, transformación, hash, flags de calidad e ingestion
run. Los datos revisables conservan vintage y lineage; una revisión no sobreescribe
historia.

### Calidad

- Zod valida cada frontera externa.
- Unit tests no usan red.
- Toda fórmula cubre `null`, cero, negativos, mismatch de moneda y resultados no
  finitos.
- Los contratos de proveedor prueban paginación, respuesta parcial, schema
  inesperado, timeout, `429` y `5xx`.
- Las rutas críticas tienen equivalente accesible y E2E cuando su fase lo exige.

### Accesibilidad y experiencia

- Objetivo WCAG 2.2 AA en tema claro y oscuro.
- Navegación por teclado, foco visible, reflow y reduced motion.
- Verde y rojo no son el único canal de significado.
- Cada gráfico tiene descripción y tabla equivalente.
- Los números usan formato `es-AR`, dígitos tabulares y unidad visible.

### Seguridad y privacidad

- Secrets, DB, proveedores e IA son server-only.
- No existen claves `NEXT_PUBLIC_*` sensibles.
- Endpoints con costo validan modo, payload, rate limit y error seguro.
- No se registran credenciales, headers, prompts completos ni documentos privados
  por defecto.
- Analytics de terceros permanece deshabilitado hasta una decisión explícita.

## Entrega incremental

| Hito      | Resultado observable                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Fase 0    | contratos, decisiones y gobierno suficientes para implementar sin ambigüedad estructural                |
| Fase 1    | una empresa fixture recorre identidad, persistencia, provenance y FCFF demo de extremo a extremo        |
| Fases 2-3 | universo CEDEAR auditable, screener y divergencias con negativos y acciones reconciliados               |
| Fase 4    | valuación no financiera multi-etapa reproducible; cierre del MVP útil                                   |
| Fases 5-9 | arquetipos adicionales, Argentina, IA acotada, persistencia personal y hardening según evidencia de uso |

El alcance autorizado en cada momento se toma exclusivamente del roadmap. La
existencia de un requisito futuro en este PRD no autoriza su implementación.

## Métricas de éxito

- 100% de resultados materiales con fuente, fecha y unidad completas.
- 100% de valuaciones aceptadas reproducibles desde su snapshot.
- Menos de 60 segundos hasta un primer insight útil una vez implementado el flujo.
- Cobertura y porcentaje `not_available` visibles por universo y métrica.
- Antigüedad, fallas y consumo medidos por fuente e ingestion run.
- Correcciones o rechazos de propuestas IA medidos cuando esa capacidad exista.
- Éxito y tiempo del walkthrough del owner en cada slice con UI.

Estas son métricas objetivo. No se consideran alcanzadas hasta contar con
instrumentación y evidencia.

## Fuera de alcance

- ejecución de órdenes, broker, custodia o tiempo real;
- asesoramiento personalizado por patrimonio o tolerancia al riesgo;
- cuentas, login propio, roles, multi-tenancy o BYOK;
- pagos, portfolios sociales, noticias genéricas o copy trading;
- RAG/vector database sin una necesidad demostrada;
- app móvil nativa;
- redistribución pública de datos live sin nuevo gate.

## Criterio de aceptación del producto

Una capacidad sólo está terminada cuando su pregunta y cobertura son claras; los
datos, fórmulas y versiones están documentados; happy path, bordes y degradación
están probados; la UI muestra trazabilidad y calidad; y el gate de su fase aporta
evidencia reproducible. Los checkboxes y el registro de sesiones del roadmap son
la única fuente de estado.

## Decisiones abiertas

- contratos y retención del plan de mercado concreto;
- proveedor licenciado para Chicago y para MEP/CCL;
- reconciliación de foreign filers, ADRs y taxonomías;
- región y plan de Postgres/Vercel;
- mecanismo durable de jobs cuando el refresh exceda una Function;
- alcance regulatorio si alguna vez se sirve información live a terceros.
