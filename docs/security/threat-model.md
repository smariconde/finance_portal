# Threat model

- Estado: baseline aceptada para Fase 0B.6
- Fecha: 2026-08-21
- Tracker de mitigaciones: [`../backlog/README.md`](../backlog/README.md#cobertura-de-deuda-transversal)
- Alcance: repositorio público, runtime trabado y runtime personal de un único owner
- Revisado el 2026-08-26: la ADR 0004 eliminó la demo anónima y la ADR 0005 movió la resolución del modo al request
- Revisión obligatoria: antes de cada nueva frontera web, proveedor, export, capacidad IA o cambio de exposición

## Objetivo y método

Este documento modela amenazas contra confidencialidad, integridad financiera,
disponibilidad y control de costo. Sigue las cuatro actividades propuestas por
OWASP: descomponer el sistema, identificar y priorizar amenazas, registrar
mitigaciones y revisar el modelo. STRIDE se usa como vocabulario, no como una
garantía de cobertura automática.

Un control puede estar en uno de estos estados:

- `implemented`: existe en código o configuración versionada y tiene evidencia.
- `contracted`: está definido por ADR o contrato, pero su slice aún no existe.
- `required`: debe bloquear la feature que lo necesita.

La ausencia de login propio es deliberada. En modo personal, la identidad del owner
se resuelve fuera de la aplicación mediante localhost controlado o protección de
plataforma. Dentro de la aplicación se autoriza cada capacidad por modo efectivo,
módulo habilitado y gate de fase.

## Activos y propiedades

| Activo                                         | Confidencialidad | Integridad | Disponibilidad | Regla principal                                  |
| ---------------------------------------------- | ---------------- | ---------- | -------------- | ------------------------------------------------ |
| Credenciales de DB, proveedores, cron e IA     | crítica          | alta       | media          | server-only; nunca repo, browser ni logs         |
| Snapshots, preferencias y tesis del owner      | alta             | alta       | alta           | sólo Postgres personal y backups autorizados     |
| Identidad, provenance y tiempo de conocimiento | media            | crítica    | alta           | lineage append-only y consultas `as_known`       |
| Fórmulas, supuestos aceptados y resultados     | media            | crítica    | alta           | versiones, hash y replay determinista            |
| Fixtures de test                               | pública          | alta       | media          | sintéticas, deterministas y sin origen live      |
| Cuota y presupuesto de proveedores/IA          | baja             | alta       | crítica        | límites, breaker y kill switch antes de uso live |
| Código, lockfile, CI y skills                  | pública          | crítica    | alta           | revisión, pinning y cambios trazables            |

La clasificación contractual de datos de proveedores (`R0` a `R4`) vive en
[`../data/provider-use-matrix.md`](../data/provider-use-matrix.md) y prevalece sobre
una clasificación genérica de este documento.

## Actores y supuestos

- El browser, sus extensiones y toda request HTTP se consideran no confiables.
- Una persona anónima puede conocer rutas y formatos internos del repositorio público, y puede compilar y desplegar el código.
- Un proveedor, documento, filing, nombre de empresa o payload externo puede estar
  comprometido o contener instrucciones maliciosas.
- Una dependencia npm, Action o skill puede ser vulnerable o cambiar de contenido.
- El owner puede cometer errores de configuración, reutilizar una key o publicar por
  accidente un deployment personal.
- Vercel, PostgreSQL y futuros proveedores son fronteras externas; sus controles no
  reemplazan validación y minimización dentro de la aplicación.
- No se protege contra un host local ya comprometido. Sí se limita el impacto de una
  credencial, dependencia, request o parser comprometidos.

## Flujo y fronteras de confianza

```text
                         repositorio público / CI
                                  |
                                  v
browser anónimo --> [B1] Next.js trabado --> negativa
                                  |
                                  X  sin datos, sin DB y sin proveedores

browser del owner --> [B2] localhost o Preview protegido
                                  |
                                  v
                         Next.js personal server-only
                           |                  |
                        [B3]               [B4]
                           |                  |
                     PostgreSQL         jobs/adaptadores
                                              |
                                           [B5]
                                              |
                              fuentes, documentos e IA futuros
```

| Frontera                   | Riesgo dominante                                     | Contrato                                                                                     |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `B1` Internet -> trabado   | abuso de endpoints o fuga de datos live              | el runtime trabado no sirve datos ni construye repositorio; no hay dataset de reemplazo      |
| `B2` owner -> personal     | exposición por deployment mal protegido              | `APP_MODE` + `APP_RUNTIME_ACCESS`; verificación externa de protección                        |
| `B3` runtime -> PostgreSQL | inyección, exceso de privilegio, fuga o corrupción   | repository server-only, queries parametrizadas, pooled runtime y direct migrations separadas |
| `B4` runtime -> jobs       | replay, concurrencia, costo y fallas parciales       | schema, presupuesto, idempotencia, lease y último snapshot válido                            |
| `B5` jobs -> terceros      | SSRF, schema hostil, prompt injection y términos     | adapters allowlisted, validación, provenance y matriz de uso aprobada                        |
| repo/CI -> deployment      | supply chain, secretos en build y permisos excesivos | lockfile, install congelado, Actions por SHA y permisos mínimos                              |

Los Server Components llaman servicios de aplicación directamente. No se agrega una
frontera HTTP interna artificial y ningún render consulta proveedores.

## Criterio de prioridad

- `critical`: puede publicar datos/secretos, ejecutar una acción costosa sin control o
  corromper silenciosamente una decisión financiera. Bloquea la feature.
- `high`: daño material con precondiciones o detección razonable. Debe cerrar dentro del
  slice que introduce la superficie.
- `medium`: degradación acotada o control compensatorio disponible. Puede quedar como
  deuda explícita con owner y gate.

## Registro de amenazas

| ID      | Escenario / STRIDE                                                                                                       | Prioridad | Controles presentes                                                                                                                                                                            | Gate y riesgo residual                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TM-01` | Production o una URL anónima activa `personal` y expone snapshots. Spoofing / information disclosure.                    | critical  | `implemented`: resolución fail-closed a `locked` (ADR 0004); el modo se resuelve en el request y no se hornea en el build (ADR 0005); Vercel Production no puede activar personal.             | `F1-07` sirve **un mismo build** desde dos entornos y verifica que el trabado niega toda superficie de datos. Antes de Preview se verifica Vercel Authentication desde una sesión anónima. Residual: atestación manual de protección.                                           |
| `TM-02` | Una key aparece en Git, bundle, HTML/RSC, error o log. Information disclosure.                                           | critical  | `implemented`: `.env*` ignorados, health sólo enumera nombres faltantes, variables privadas sin `NEXT_PUBLIC_`. `contracted`: DTO mínimo y redacción de logs.                                  | `F1-07` inyecta un centinela por variable y verifica que ninguno aparezca en el health serializado ni en el body, los headers o el payload RSC de ninguna ruta, en ambos modos. Cada frontera nueva agrega su propio test. Un leak exige revocación, no sólo borrar el archivo. |
| `TM-03` | Route Handler o Server Action se invoca directamente y saltea la UI. Elevation / tampering.                              | critical  | `contracted`: toda frontera se trata como endpoint público; guard de modo en web y application service. Todavía no existe ninguna Route Handler ni Server Action.                              | `F1-07` probó las fronteras que hoy existen —las raíces de composición— y su fallo cerrado. El primer endpoint implementa Zod, límite de body, método, origen cuando aplique, presupuesto/rate limit y envelope seguro.                                                         |
| `TM-04` | Un runtime trabado obtiene cache o repository personal. Information disclosure.                                          | critical  | `implemented`: el modo efectivo forma parte de keys/tags; la composición server-only lanza `RuntimeLockedError` y no construye repositorio alternativo; un runtime trabado no abre PostgreSQL. | `F1-07` prueba los cinco selectores contra seis entornos trabados y verifica que no se pide siquiera la base. El E2E confirma que el artefacto servido trabado no filtra contenido de la corrida.                                                                               |
| `TM-05` | Parser roto, fuente comprometida o respuesta parcial publica datos falsos. Tampering.                                    | critical  | `contracted`: staging, schema Zod, content hash, lineage, quality flags y último snapshot válido.                                                                                              | Fase 2 agrega contract tests, reconciliación y validación semántica XBRL de muestra; una falla pone en cuarentena, nunca reemplaza por vacío o cero.                                                                                                                            |
| `TM-06` | Ticker reutilizado, ADR/CEDEAR confundido o restatement futuro altera una consulta histórica. Spoofing / tampering.      | critical  | `implemented`: contratos de identidad y point-in-time.                                                                                                                                         | Migración y repositories de Fases 1-2 preservan IDs estables, vigencia y `available_at`; golden fixtures prueban ambigüedad y look-ahead.                                                                                                                                       |
| `TM-07` | Filtros, IDs o payloads producen SQL injection o consultas sin límite. Tampering / denial of service.                    | high      | `contracted`: Drizzle/queries parametrizadas, schemas cerrados y ports de repository.                                                                                                          | Fases 1-2 fijan límites de página, columnas/filtros allowlisted, timeout y tests de payload hostil; no se acepta SQL del browser o agente.                                                                                                                                      |
| `TM-08` | Una URL, redirect o DNS controlado alcanza metadata, localhost o red privada. SSRF.                                      | high      | `required`: el render no hace fetch externo; research/provider adapters reciben IDs o dominios aprobados, no URL arbitraria.                                                                   | Antes del primer extractor: HTTPS, allowlist, resolución y redirects validados, rangos privados bloqueados, tamaño/timeout acotados.                                                                                                                                            |
| `TM-09` | Filing, web o nombre de empresa inyecta instrucciones en una feature IA. Tampering / elevation.                          | high      | `required`: evidencia se trata como datos; herramientas tipadas; IA no calcula ni muta; output estructurado y policy engine.                                                                   | Fase 7 exige evals de injection, evidence IDs, abstención, allowlist y ninguna URL/SQL arbitrarios. Residual: contenido hostil se muestra como no confiable.                                                                                                                    |
| `TM-10` | Abuso o loop agota cuota, crédito IA o recursos de Function. Denial of service.                                          | high      | `contracted`: páginas sin llamadas live, batching y presupuesto por corrida.                                                                                                                   | Proveedor/IA no se habilita sin límite por request/día, circuit breaker, timeout, observabilidad y kill switch.                                                                                                                                                                 |
| `TM-11` | Cron o refresh se repite, corre en paralelo o procesa un mensaje venenoso. Tampering / denial of service.                | high      | `contracted`: idempotency key, lock/lease, cursor, checkpoint y último snapshot válido; Cron live sigue deshabilitado.                                                                         | El slice que agregue jobs prueba replay, concurrencia, `429`, crash y recuperación manual antes de programarlos.                                                                                                                                                                |
| `TM-12` | Contenido no confiable causa XSS, clickjacking o exfiltra datos a otro origen. Tampering / information disclosure.       | high      | `implemented`: React escapa contenido; no hay HTML externo. El `dangerouslySetInnerHTML` actual contiene sólo un comentario estático de diseño.                                                | Antes de contenido/proveedores o preview público: headers base, CSP compatible con Next.js, `frame-ancestors`, política de referrer y test de render hostil. Nunca interpolar input en HTML.                                                                                    |
| `TM-13` | Dependencia, Action o skill maliciosa ejecuta código con acceso al repo/secrets. Elevation / tampering.                  | high      | `implemented`: `pnpm-lock.yaml`, CI con `--frozen-lockfile`, permisos `contents: read`, Actions por SHA; Impeccable fijada y hooks/red/update deshabilitados.                                  | Actualizaciones en PR separado; revisar scripts y diffs. Fase 9 agrega dependency/secrets scan; ninguna skill autoriza red o ejecución por estar instalada.                                                                                                                     |
| `TM-14` | Preview de fork, bypass de automation o variable compartida recibe secretos personales. Information disclosure.          | high      | `contracted`: Production sin DB/keys personales; Preview personal protegida; secretos por entorno y branch.                                                                                    | Antes de deploy: comprobar que forks no reciben secretos, inventariar bypasses y probar URL exacta en incógnito.                                                                                                                                                                |
| `TM-15` | Raw, export, backup o prompt viola retención/licencia o expone la tesis del owner. Information disclosure / repudiation. | high      | `implemented`: matriz de uso mantiene desconocidos cerrados; un runtime trabado no consulta ninguna fuente. `contracted`: data map, exports allowlisted y audit trail.                         | Cada proveedor bloquea su spike sin rights row aprobada. Fases 7-8 agregan data map, borrado y restore respetando licencia.                                                                                                                                                     |
| `TM-16` | Logs insuficientes impiden explicar una mutación, ingesta o resultado incorrecto. Repudiation.                           | medium    | `contracted`: IDs de request/run/valuation, versión, modo, outcome y hashes sin contenido sensible.                                                                                            | El slice que cree la operación añade eventos y failure-path tests; no se guardan prompts completos, headers ni documentos privados.                                                                                                                                             |

## Controles mínimos por frontera futura

### Route Handler o Server Action

1. Verificar modo efectivo y módulo habilitado dentro de la frontera y del servicio.
2. Aceptar sólo método, media type y schema esperados; limitar tamaño y cardinalidad.
3. No confiar en `Host`, `Origin`, query strings o props como prueba de modo personal.
4. Aplicar presupuesto/rate limit antes de reclamar trabajo costoso.
5. Usar respuesta tipada con `request_id`; no eco de input, stack, SQL o configuración.
6. Probar invocación directa, runtime trabado, payload grande, schema inválido y fallo de dependencia.

Next.js compara por defecto el origen de Server Actions con el host y limita su body a
1 MB, pero ambos son defensa en profundidad: no sustituyen el guard de capacidad ni
justifican ampliar `allowedOrigins` o `bodySizeLimit` sin un caso medido.

### Provider, parser o extractor

1. Aprobar rights row, dataset, retención, cuota y salida antes de llamar la red.
2. Usar cliente server-only, egress/domains acotados, timeout, tamaño y paginación.
3. Validar forma y semántica; guardar hash, provenance, parser version y run ID.
4. Publicar staging atómicamente; conservar el último snapshot válido.
5. Separar input externo de instrucciones de agente/IA.

### Persistencia y cache

1. Privilegios mínimos y URLs pooled/direct separadas.
2. IDs internos estables; nunca ticker como foreign key.
3. Tiempo efectivo y de conocimiento en cada lectura histórica.
4. Cache key con modo, dataset y versión; invalidación no modifica Postgres.
5. Backup/export hereda derechos y clasificación del dato original.

## Abuso y respuesta

| Señal                                      | Respuesta segura                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| despliegue personal accesible anónimamente | trabar el runtime o retirar el deployment; rotar keys si hubo exposición; registrar alcance               |
| key en Git/log/browser                     | revocar en origen, detener capacidad, revisar historial y redeploy; no asumir que borrar el valor alcanza |
| parser/schema inesperado                   | cuarentena, marcar módulo degradado y conservar último snapshot válido                                    |
| gasto o cuota anormal                      | abrir breaker/kill switch, detener jobs y preservar cursor para recuperación manual                       |
| valuación materialmente incorrecta         | marcar corridas afectadas, conservar audit trail, incrementar versión y recalcular explícitamente         |
| dependencia/skill comprometida             | inmovilizar versión, deshabilitar automatización, revisar accesos y reemplazar mediante cambio separado   |

## Estado por fase

| Fase | Controles que deben estar implementados antes del gate                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | baseline, modos fail-closed, env health sin valores, lockfile/CI pinneada y derechos desconocidos cerrados                                    |
| 1    | guard reutilizable al crear fronteras, repositorios separados, DB con mínimo privilegio, tests de aislamiento y headers base antes de preview |
| 2    | egress/provider policy, parser quarantine, cuotas, idempotencia, identity/PIT y contract tests                                                |
| 3-6  | invariantes financieras, lineage, revisión semántica, accesibilidad equivalente y degradación por módulo                                      |
| 7    | budget/kill switch IA, data map, injection evals, evidence IDs y routing/política trazados                                                    |
| 8    | backup/restore/borrado, exports acotados y persistencia personal protegida                                                                    |
| 9    | secret/dependency scan, restore e incident drills, CSP/headers auditados y checklist de exposición firmado                                    |

## Verificación y mantenimiento

- Owner: responsable técnico del repositorio.
- Revisar este archivo al cambiar topología, modo, hosting, DB, scheduler, proveedor,
  capacidad IA, export, clasificación o actor.
- Un riesgo `critical` sin control implementado bloquea la feature que lo introduce;
  no bloquea un slice anterior donde la superficie todavía no existe.
- Cada mitigación futura enlaza test, ruta, ADR o runbook. Marcarla sólo por intención
  no reduce el riesgo residual.

## Fuentes primarias

- [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html)
- [Next.js: Server Actions configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions)
- [Next.js: production security checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [Next.js: security of Route Handlers and Server Actions](https://nextjs.org/docs/app/guides/authentication)
- [Next.js: response headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers)
- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)
- [Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
