# Sistema del agente y skills

## Objetivo

Dar al agente conocimiento procedural preciso sin inflar el contexto ni permitir que instrucciones de terceros gobiernen el repo. Las convenciones durables viven en `AGENTS.md`; las tareas especializadas y repetibles viven en skills.

## `AGENTS.md` raiz

Debe contener:

- objetivo y alcance/no alcance del producto;
- estructura y fronteras de modulos;
- comandos oficiales (`dev`, `lint`, `typecheck`, `test`, `test:e2e`, `build`, migraciones);
- reglas server/client, provider ports y provenance;
- identidad entity/security/listing, datos point-in-time y prohibicion de look-ahead;
- formulas solo en dominio puro y Decimal policy;
- no secrets, no valores faltantes convertidos a cero, no llamadas reales en unit tests;
- criterios de verificacion y formato de handoff;
- requerimiento de ADR para nuevas dependencias estructurales/proveedores.

No poner toda la metodologia Damodaran en `AGENTS.md`; debe referenciar la skill y `docs/valuation/methodology.md`.

## Skills externas recomendadas

Instalar a nivel proyecto, una por una, despues de inspeccionar fuente, licencia y contenido. Nunca `--all` ni global en el bootstrap.

```bash
pnpm dlx skills add vercel-labs/next-skills --list
pnpm dlx skills add vercel-labs/next-skills --skill next-best-practices --agent codex

pnpm dlx skills add vercel-labs/agent-skills --list
pnpm dlx skills add vercel-labs/agent-skills --skill vercel-react-best-practices --agent codex
pnpm dlx skills add vercel-labs/agent-skills --skill web-design-guidelines --agent codex

pnpm dlx skills add vercel/ai --list
pnpm dlx skills add vercel/ai --skill ai-sdk --agent codex
```

Luego:

- revisar el diff y cualquier script incluido;
- conservar `skills-lock.json` si el CLI lo genera;
- registrar repo, commit/ref, licencia y fecha en `docs/agent/skills-inventory.md`;
- bloquear actualizaciones automaticas; actualizar en PR separado;
- eliminar duplicados o skills que se contradigan.

El registro skills.sh advierte que no garantiza la calidad/seguridad de todos los paquetes; la popularidad no reemplaza auditoria.

## Skills propias del repo

Al generarlas, poner todos los triggers en el campo `description` del frontmatter; el body se carga despues del trigger. Mantener `SKILL.md` corto y mover formulas/schemas a una referencia de primer nivel. Incluir `agents/openai.yaml` generado desde el contenido de la skill.

### `damodaran-valuation-engine`

Trigger: cambios en metodos, supuestos, WACC, terminal value, escenarios o output de valuacion.

Debe exigir:

1. identificar moneda, pais/exposicion, sector, lifecycle y arquetipo;
2. seleccionar metodo antes de codigo/prompt;
3. separar supuestos y evidencia;
4. formulas deterministicas y escenarios;
5. checks economicos/matematicos;
6. golden/property tests;
7. output schema y UI trace.

Referencias locales: metodologia, formulas, matriz de metodos y fixtures. Scripts opcionales: selector de metodo y validador de output.

### `financial-data-provenance`

Trigger: nuevo proveedor, endpoint, parser, metrica o serie.

Debe exigir source registry y derechos del plan concreto antes del spike, schema Zod, fixture sanitizada, entity/security/listing mapping, `available_at`, vintage/restatement, unit/currency/timezone, idempotencia, lineage, freshness, fallback, reconciliacion y contract test. Para XBRL debe pedir una validacion semantica de muestra, no solo schema.

### `financial-visualization-review`

Trigger: scatter, heatmap, ratio table o dashboard macro.

Implementada en `.agents/skills/financial-visualization-review/`. Revisa
definición/ejes/unidad, negativos y N/M, outliers, comparabilidad agregada vs por
acción, tooltips, fuente/vintage, WCAG 2.2 AA, equivalente tabular, responsive y
presupuesto del renderer.

Su mejora es acotada y auditable: una corrección del usuario, un gate fallido o un
patrón repetido puede producir un `Skill improvement candidate` con evidencia,
alcance, regla y contraejemplo. No se autoedita durante una tarea común. Una
actualización requiere alcance explícito de mantenimiento, dos ejemplos del repo o
una especificación autoritativa más un ejemplo, `quick_validate.py`, revisión del
diff e inventario actualizado. No habilita hooks ni aprendizaje por red.

### `release-quality-gate`

Trigger: final de fase/release.

Debe ejecutar checks, revisar migraciones, envs, bundles, E2E, secrets, terminos de uso personal/cache, separacion `personal | demo`, observabilidad, rollback y changelog de metodologia.

## Estructura de skill

```text
.agents/skills/<name>/
  SKILL.md
  agents/
    openai.yaml
  references/       # solo material necesario
  scripts/          # validadores deterministas, no wrappers cosmeticos
```

Cada `SKILL.md` tiene `name`, `description` con triggers claros, workflow corto, gates y links relativos. No duplicar documentacion completa; cargar referencias bajo demanda.

Inicializar y validar con las herramientas de `skill-creator` disponibles en la sesion, en lugar de armar carpetas incompletas a mano. Flujo esperado: `init_skill.py`, completar recursos reales, generar `agents/openai.yaml`, ejecutar scripts representativos y terminar con `quick_validate.py`.

Ejemplos de activacion para forward-test:

- "Agrega el modelo de exceso de retorno para un banco" activa valuacion.
- "Integra el endpoint de market cap historica" activa provenance.
- "Construye el scatter 5Y con CEDEAR" activa visualizacion y provenance.
- "Prepara la Fase 3 para release" activa el quality gate.

Una prueba falla si la skill no se activa, si activa dos workflows contradictorios o si solo funciona porque el agente vio el resultado esperado.

## Flujo de bootstrap del agente

1. Leer masterplan.
2. Leer el estado de `06_PHASED_ROADMAP.md`, elegir solo la fase/slice activa y crear `AGENTS.md` y docs derivadas cuando corresponda.
3. Inventariar skills ya disponibles.
4. Listar paquetes externos antes de instalar.
5. Auditar y versionar las skills seleccionadas.
6. Crear cada skill local cuando exista un trigger real; no generar las cuatro por completar una lista.
7. Ejecutar `quick_validate.py` para cada skill creada o modificada.
8. Ejecutar una prueba de activacion: pedir un provider, una valuacion y un chart review y comprobar que cada skill dirige el workflow correcto.
9. Actualizar checklist, evidencia, bloqueos y proximo slice del roadmap antes del handoff.

## Lo que una skill no debe hacer

- descargar/ejecutar binarios sin revision;
- exigir un stack distinto al ADR;
- contener API keys o ejemplos reales;
- autorizar writes externos, deploy o gastos;
- reemplazar tests o documentacion de dominio;
- imponer una mega-metodologia a toda tarea.
