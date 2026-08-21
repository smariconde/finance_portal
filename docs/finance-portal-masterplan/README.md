# Masterplan portable: portal financiero inteligente

Este directorio es un kit de arranque para crear un portal financiero personal en Next.js. El codigo puede ser publico, pero la instancia con datos y claves reales es de un unico owner: se ejecuta localmente o en un deployment protegido. Una demo anonima usa fixtures y no llama proveedores. No es una especificacion para copiar la app Streamlit actual: conserva sus mejores ideas y las redisena como un producto web modular y trazable.

## Resultado buscado

El producto debe responder preguntas concretas:

- Que empresas cumplen determinados ratios y como cambiaron en 2 o 5 anos.
- Cuales de esas empresas tienen CEDEAR activo y cual es su ratio de conversion.
- En que empresas el EPS crecio mas rapido que la capitalizacion de mercado.
- Cuanto vale una empresa bajo un metodo adecuado a su tipo y ciclo de vida.
- Que esta mostrando el regimen macro argentino y que datos sostienen esa lectura.
- Que supuestos, fuentes, fechas y riesgos explican cada resultado.

La IA propone, clasifica, investiga y explica. El codigo deterministico descarga, normaliza, calcula, valida y guarda. Ningun numero de valuacion debe depender de que un LLM haga aritmetica libre.

## Como usar este kit

1. Mantener este directorio en `docs/finance-portal-masterplan/`. Si se copia con otro nombre, actualizar primero todas las rutas del prompt maestro.
2. Abrir una sesion nueva del agente en la raiz del repo.
3. Pegar el contenido de `00_MASTER_PROMPT.md`.
4. Ejecutar una sola fase o slice vertical acotado por sesion. No pedir todas las fases ni todas las secciones completas en un unico cambio.
5. Actualizar el estado, checklist y evidencia en `06_PHASED_ROADMAP.md` al cerrar cada sesion.
6. No iniciar una fase nueva hasta cumplir el gate de la actual; una excepcion requiere ADR y motivo verificable.

## Perfil operativo

- Un solo owner, sin registro, login propio, roles, multi-tenancy ni BYOK.
- Claves en variables server-only; nunca en el navegador ni en el repositorio publico.
- Postgres conserva precios, fundamentales, preferencias y valuaciones entre sesiones. El cache de Next.js acelera lecturas, pero no es la fuente durable.
- `localStorage` puede guardar preferencias visuales o borradores; `sessionStorage` no guarda datos financieros ni credenciales.
- Modo `personal`: datos reales en localhost o deployment protegido. Modo `demo`: fixtures deterministas y URL publica segura.

## Mapa de documentos

- `00_MASTER_PROMPT.md`: prompt inicial autocontenido para la sesion especial.
- `01_PRODUCT_AND_SCOPE.md`: producto, usuarios, preguntas, limites y rutas.
- `02_ARCHITECTURE.md`: arquitectura, modulos, contratos y persistencia.
- `03_DATA_AND_PROVENANCE.md`: fuentes, adaptadores, CEDEAR, Argentina y trazabilidad.
- `04_VALUATION_SYSTEM.md`: motor Damodaran, seleccion de metodo, IA y controles.
- `05_UX_UI.md`: experiencia, paginas, graficos y accesibilidad.
- `06_PHASED_ROADMAP.md`: fases, entregables, gates y definicion de terminado.
- `07_AGENT_AND_SKILLS.md`: AGENTS.md, skills externas y skills propias.
- `08_QUALITY_SECURITY_OPERATIONS.md`: pruebas, seguridad, costos y operacion.
- `09_ENVIRONMENT_AND_DEPLOY.md`: variables, setup y despliegue Vercel.
- `10_DECISIONS_AND_SOURCES.md`: decisiones ya tomadas y bibliografia primaria.

## Documentos derivados

- [`../architecture/adr/0001-stack-cache-postgres.md`](../architecture/adr/0001-stack-cache-postgres.md): decision aceptada sobre stack, Cache Components y conexiones PostgreSQL.
- [`../architecture/adr/0002-runtime-modes-persistence-exposure.md`](../architecture/adr/0002-runtime-modes-persistence-exposure.md): modos efectivos, persistencia durable y limite de exposicion de datos.
- [`../product/prd.md`](../product/prd.md): requisitos de producto, modos, alcance, métricas y criterios de aceptación.
- [`../architecture/system.md`](../architecture/system.md): límites ejecutables, flujos, dependencias, cache y persistencia objetivo.
- [`../data/source-registry.md`](../data/source-registry.md): contrato del registro e inventario de fuentes candidatas sin aprobaciones implícitas.
- [`../data/provider-use-matrix.md`](../data/provider-use-matrix.md): matriz de derechos, cache, retención, cuotas y gates antes de cualquier spike real.
- [`../data/identity-model.md`](../data/identity-model.md): separación entity/security/listing/symbol, programas depositarios y resolución de identidad.
- [`../data/point-in-time-contract.md`](../data/point-in-time-contract.md): vigencia, conocimiento, revisiones, consultas as-known y snapshots reproducibles.
- [`../valuation/methodology.md`](../valuation/methodology.md): política numérica, selección de métodos, FCFF, checks y reproducibilidad.

## Principios no negociables

1. Fuente y fecha visibles para todo dato importante.
2. Unidades, moneda, periodo fiscal y politica de ajustes forman parte del dato.
3. Formulas puras, versionadas y cubiertas por tests.
4. Los supuestos de IA usan salida estructurada, limites economicos y evidencia.
5. Fallas de un proveedor degradan una seccion; no rompen todo el portal.
6. Secretos solo en servidor, nunca con prefijo `NEXT_PUBLIC_`.
7. El MVP es un monolito modular. Se extrae un servicio solo cuando una metrica real lo justifica.
8. No hay recomendaciones personalizadas ni ejecucion de operaciones.
9. Cada fuente debe permitir uso personal y la persistencia necesaria; redistribucion solo importa si algun dia se habilitan datos reales en una URL anonima.
10. Cada fase termina con una version desplegable.
11. Empresa, instrumento, clase, listing y programa depositario son identidades distintas.
12. Reproducible significa recalcular un snapshot persistido; volver a consultar una IA no promete la misma respuesta.
13. Publicar el codigo no equivale a publicar los datos: una demo publica no expone payloads ni endpoints del modo personal.

## Estado actual

El masterplan esta revisado y la Fase 0 se encuentra en progreso. El estado operativo y el historial de sesiones viven exclusivamente en `06_PHASED_ROADMAP.md`; no se infiere avance por la mera existencia de una pagina o documento.
