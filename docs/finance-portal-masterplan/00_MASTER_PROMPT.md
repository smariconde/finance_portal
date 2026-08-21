# Prompt maestro para iniciar el repositorio limpio

Copiar desde `COMIENZO DEL PROMPT` hasta `FIN DEL PROMPT` en una sesion nueva.

---

## COMIENZO DEL PROMPT

Actua como lead engineer, product engineer y analista cuantitativo responsable de construir un portal financiero inteligente, serio y desplegable directamente en Vercel.

Estas en un repositorio limpio. Antes de escribir codigo:

1. Lee completamente `docs/finance-portal-masterplan/README.md` y todos los archivos `docs/finance-portal-masterplan/00_*.md` a `docs/finance-portal-masterplan/10_*.md`.
2. Inspecciona las instrucciones y skills disponibles en la sesion. Usa las que apliquen.
3. Verifica en documentacion primaria las versiones y APIs que puedan haber cambiado. No adivines firmas de Next.js, Vercel, AI SDK, OpenRouter ni proveedores financieros.
4. Consulta `06_PHASED_ROADMAP.md`, identifica la primera fase no terminada y crea un plan solo para esa fase o para un slice vertical menor. Las fases futuras quedan documentadas, no simuladas ni implementadas a medias.
5. Si una decision requiere contratar un proveedor, aceptar terminos nuevos, habilitar datos live en una URL anonima o crear un recurso externo con costo, documenta la decision y pide autorizacion antes de efectuarla. Puedes dejar ports, adaptadores y mocks listos.
6. Al terminar la sesion, actualiza estado, checklist, evidencia, bloqueos y proximo slice en `06_PHASED_ROADMAP.md`. Solo marca `done` cuando el gate tenga evidencia.

### Objetivo de producto

Construir una aplicacion web en espanol, mobile-first y profesional que:

- busque y compare empresas por ratios actuales e historicos de 2/5 anos;
- distinga visualmente las acciones con CEDEAR y conserve el mapeo al subyacente;
- muestre divergencias de crecimiento con vistas agregada y por accion: market cap vs net income, precio vs EPS y un puente de acciones; puede conservar `fundamental_gap_pp` como diagnostico, no como ranking aislado;
- valore empresas automaticamente con metodos apropiados a cada arquetipo bajo principios de Damodaran;
- muestre escenarios, sensibilidades, incertidumbre, calidad de datos y todos los supuestos editables;
- incluya un tablero argentino basado prioritariamente en BCRA, INDEC/datos.gob.ar, BNA, Caja de Valores/BYMA y Bolsa de Comercio de Rosario;
- use IA para investigacion con evidencia, propuesta de supuestos y explicacion, pero nunca para ejecutar la aritmetica financiera;
- opere como instancia de un solo owner, con claves server-only, sin login propio, cuentas, multi-tenancy ni BYOK; el repositorio puede ser publico y una demo anonima usa solo fixtures.

### Arquitectura obligatoria para el MVP

- Next.js estable actual con App Router, React, TypeScript estricto, pnpm y Node LTS compatible con Vercel.
- Una sola aplicacion y un monolito modular. No microservicios.
- React Server Components por defecto; Client Components solo para interaccion y graficos.
- Route Handlers para cron, interaccion client-side, streaming y webhooks. Aunque no haya cuentas, validar modo de ejecucion, secreto de cron cuando aplique, tamano, schema, rate limit y errores. En `demo` deshabilitar ingesta, mutaciones costosas e IA.
- Servicios de dominio invocados directamente desde Server Components; no hacer fetch HTTP interno a los propios Route Handlers.
- PostgreSQL serverless provisionable desde Vercel Marketplace, pooling para runtime, conexion directa controlada para migraciones, Drizzle ORM y migraciones versionadas.
- `server-only` en adaptadores, acceso a base, secretos y orquestacion de IA.
- shadcn/ui + Tailwind para UI; Recharts a traves de los componentes de chart de shadcn para el MVP; TanStack Table para el screener.
- Zod en cada frontera externa; tipos de dominio distintos de DTOs de proveedor.
- Vercel AI SDK y proveedor oficial de OpenRouter para salida estructurada/streaming. Verifica la API contra la version instalada.
- Vitest, Testing Library, Playwright, MSW y fast-check donde agregue valor.
- ESLint, Prettier, TypeScript sin errores y CI en GitHub Actions.

### Datos y proveedores

Implementa interfaces reemplazables. Ningun componente de UI debe conocer el JSON de un proveedor.

Prioridad de fuentes:

1. SEC EDGAR para identidad, filings/XBRL y fundamentales estadounidenses.
2. Alpaca Basic como candidato inicial para precios EOD/historicos en modo personal: usar bars multi-symbol, paginacion y un limite interno con margen sobre el rate limit publicado. No prometer tiempo real. Mantener el port reemplazable; FMP/Twelve Data quedan como alternativas, no como llamadas simultaneas.
3. Caja de Valores/Comafi para registro y ratios CEDEAR; BYMA para contexto oficial. Para el universo S&P 500 de desarrollo usar un snapshot versionado y fechado del dataset PDDL de DataHub, no scraping en cada request.
4. API Estadisticas Monetarias v4 del BCRA, catalogo oficial vigente, API Series de Tiempo de Argentina e INDEC para macro. No confundirla con versiones deprecadas de Principales Variables.
5. BNA para FX de referencia y BCR/Camara Arbitral para pizarra Rosario.
6. Un feed con licencia clara para Chicago soja. No uses `yfinance` ni endpoints privados de Yahoo como dependencia productiva.
7. NYU Stern/Damodaran para ERP, CRP y agregados sectoriales, guardando fecha y version de cada descarga.
8. Tavily solo para evidencia cualitativa y documentos, con allowlist de dominios cuando corresponda.

Modos obligatorios:

- `personal`: proveedores reales habilitados, solo en localhost o deployment protegido por la plataforma;
- `demo`: fixtures deterministas, sin provider keys, ingestas live, mutaciones persistentes ni endpoints IA.

Las paginas leen Postgres y nunca llaman proveedores durante el render. Precios se refrescan una vez por cierre, SEC solo ante filings nuevos y CEDEAR en cadencia semanal o por anuncio. Guardar uso/cuota, cursor, backoff y ultimo snapshot valido. Postgres persiste entre sesiones; `localStorage` solo guarda preferencias/borradores y `sessionStorage` no es cache financiero.

Toda observacion persistida debe incluir, como minimo: `source`, `source_url` o identificador, `as_of`, `fetched_at`, `period`, `unit`, `currency`, `raw_value`, `normalized_value`, `quality_flags` y `ingestion_run_id`.

Ademas, separar entidad legal, security/share class, listing, simbolo historico y programa depositario. Para datos revisables guardar `available_at`, fecha de filing/publicacion, vintage/restatement, transformacion/version y hash. Si una licencia impide persistir raw, registrar `raw_value_status=license_restricted`; no volverlo opcional silenciosamente.

### Reglas del grafico Market Cap vs EPS

- Alinear extremos con cierres fiscales y usar EPS diluido ajustado por splits.
- Calcular CAGR solo si ambos extremos son estrictamente positivos:
  `cagr = ((end / start) ** (1 / years) - 1) * 100`.
- Si EPS inicial o final es <= 0, clasificar como `loss_to_profit`, `profit_to_loss` o `negative_both`; no inventar un porcentaje comparable.
- Mostrar linea diagonal `y = x`, cuadrantes, color por sector, contorno/badge CEDEAR y tamano por market cap actual.
- No existe un ranking unico sin contexto. Mostrar `eps_vs_price_gap_pp`, `net_income_vs_market_cap_gap_pp`, cambio de acciones y el `fundamental_gap_pp` historico como vistas relacionadas.
- Agregar crecimiento de net income y cambio de acciones diluidas como controles para detectar recompras/dilucion.
- Si se recortan outliers para el eje, conservar el valor real en tooltip y marcarlo.

### Reglas del sistema de valuacion

- Seleccion deterministica de arquetipo y metodo; la IA puede proponer un override con confianza, evidencia y motivo, pero un policy engine valida o rechaza.
- Separar supuestos operativos, reinversion, riesgo/financiacion, terminales y ajustes contables.
- Implementar primero FCFF multi-etapa para no financieras maduras/transicion y luego ampliar segun el roadmap.
- Cubrir progresivamente: maduras, alto crecimiento, perdidas, financieras, REIT, ciclicas/commodities, holdings/SOTP y distress.
- Para bancos/aseguradoras usar modelos de equity como excess return/residual income o DDM; no FCFF estandar.
- Para ciclicas/commodities normalizar margenes o precios a traves del ciclo.
- En estado estable respetar `discount_rate > terminal_growth`, `reinvestment_rate = growth / ROIC` cuando aplique y coherencia entre crecimiento, ROE y payout en financieras.
- Riesgo libre, inflacion, flujos y moneda deben ser consistentes. El riesgo pais depende de exposicion operacional, no solo domicilio legal.
- Usar Decimal.js o una politica de precision explicita; RNG con seed para simulaciones.
- Entregar bear/base/bull, tabla de flujos, puente EV a equity, valor por accion, margen de seguridad configurable, sensibilidad WACC/g y diagnosticos.
- Cada supuesto propuesto debe tener `value`, `unit`, `source_type`, `evidence_ids`, `as_of`, `confidence`, `rationale` y rango permitido.
- Guardar input, supuestos aceptados, modelo, proveedor efectivo, routing, parametros, prompt/version, output estructurado y correcciones. El replay del snapshot aceptado es reproducible; regenerar la propuesta IA es una corrida nueva.

### Alcance de Fase 0 cuando este activa

Produce y deja versionados:

- `AGENTS.md` con convenciones, comandos, fronteras de arquitectura y gates.
- ADR inicial que registre stack, proveedores y decisiones aplazadas.
- `docs/product/prd.md`, `docs/architecture/system.md`, `docs/data/source-registry.md`, `docs/valuation/methodology.md` y `docs/runbooks/vercel.md` derivados de este masterplan, sin copiar texto inutil.
- `.env.example` sin secretos y un validador de entorno que permita arrancar aunque modulos opcionales no tengan key.
- inventario/auditoria de skills; instalar solo skills especificas, de fuentes revisadas, a nivel proyecto y con lockfile. No usar `--all`.
- backlog por fases con issues o Markdown y criterios de aceptacion verificables.

### Alcance de Fase 1, solo despues del gate de Fase 0

Construye un vertical slice desplegable:

- shell del portal, navegacion, home y paginas vacias con estados de setup;
- base de datos, migracion inicial y `source_registry`/`ingestion_runs`;
- interfaces de proveedores, un fake provider deterministico y health dashboard;
- una empresa demo con snapshot, fundamentals y una valuacion FCFF calculada por codigo;
- UI de resultado con fuentes, freshness, supuestos y sensibilidad;
- tests unitarios del dominio, contract tests del fake y un E2E del flujo demo;
- despliegue de preview o instrucciones exactas si falta autorizacion para desplegar.

No integres una API real hasta que el contrato y los tests con fixtures esten aprobados. No agregues login, cuentas, roles, multi-tenancy, BYOK, pagos, portfolios sociales, noticias genericas, trading ni RAG vectorial. Auth de aplicacion solo se reconsidera si el owner cambia expresamente el alcance.

No ejecutes Fase 0 y Fase 1 en la misma sesion. Dentro de cada una sigue los slices y estados de `06_PHASED_ROADMAP.md`.

### Forma de trabajar

- Mantener siempre una version ejecutable.
- Trabajar solo sobre la fase activa; una pagina futura puede tener un estado honesto `planned`, pero no controles falsos ni implementaciones parciales sin tests.
- Dividir una fase grande en slices verticales demostrables y cerrar una sesion con el siguiente slice explicitado.
- Antes de cada cambio material, explicar brevemente que se va a validar.
- Hacer cambios pequenos y cohesionados.
- Ejecutar lint, typecheck, unit tests y el E2E relevante.
- Revisar el diff y listar deuda/riesgos reales.
- No ocultar datos faltantes con cero ni con estimaciones silenciosas.
- No reemplazar una fuente oficial por scraping fragil sin documentar fallback, licencia y freshness.
- Cuando haya ambiguedad financiera, conservar ambas interpretaciones en el modelo y hacer explicita la elegida.

Comienza ahora leyendo todos los documentos. Despues presenta y ejecuta solamente el proximo slice autorizado por `06_PHASED_ROADMAP.md`. Al terminar, verifica, actualiza el tracker y entrega el proximo slice propuesto sin iniciarlo.

## FIN DEL PROMPT
