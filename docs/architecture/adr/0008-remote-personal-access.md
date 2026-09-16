# ADR 0008: acceso personal remoto en producción

- Estado: aceptado
- Fecha: 2026-09-04
- Alcance: enmienda la resolución de modo de la
  [ADR 0004](0004-personal-first-runtime.md); no altera la
  [ADR 0005](0005-request-time-runtime-boundary.md)
- Decisiones relacionadas: [ADR 0007](0007-ticker-driven-valuation-pivot.md)

## Contexto

La ADR 0004 definió que `personal` requiere un entorno demostrablemente privado, y
`getConfigHealth()` lo implementó admitiendo exactamente dos casos: local fuera de
Vercel, o Vercel con `VERCEL_ENV === "preview"` y acceso `protected`.

El owner quiere abrir el portal desde donde esté, no sólo desde la máquina de
desarrollo. Con la regla actual eso no funciona: un deployment de **producción** en
Vercel agrega `VERCEL_ENV` a la lista de problemas, cae a `locked` y se niega a
servir datos. La única forma de acceso remoto que el código permite hoy es una URL
de preview, que cambia con cada deployment y no sirve como destino estable.

La restricción a preview existía para que un despliegue accidental del repositorio
—que es público— no sirviera la base del owner. Ese sigue siendo un riesgo real.

## Decisión

### `personal` se admite en cualquier entorno de Vercel con acceso declarado

Se elimina la condición `VERCEL_ENV === "preview"`. `personal` sobre Vercel requiere
`APP_RUNTIME_ACCESS=protected` declarado explícitamente, más la `DATABASE_URL`
pooled que la ADR 0004 ya exigía.

El caso del despliegue accidental sigue cubierto, y no por la rama que se elimina.
`APP_MODE` sin declarar resuelve `locked` y `APP_RUNTIME_ACCESS` sin declarar
resuelve `public`, que también traba. Un tercero que clone y despliegue este
repositorio obtiene una negativa salvo que configure deliberadamente dos variables
y una base de datos propia. La regla de preview no aportaba nada contra esa amenaza:
sólo bloqueaba al owner.

### La protección de la URL es responsabilidad del deployment, no de la aplicación

`APP_RUNTIME_ACCESS=protected` es una **declaración del owner** de que la URL está
detrás de la protección de la plataforma. La aplicación no puede verificarlo desde
adentro y no simula hacerlo: no existe autenticación de aplicación, y la ADR 0004
mantiene esa decisión de alcance.

Consecuencia operativa, que va al runbook de despliegue: activar Deployment
Protection en el proyecto **antes** de declarar `protected`. Sin eso la URL es
pública, y la declaración es falsa aunque el modo diga `personal`.

Un hecho que el repositorio ya tenía registrado y que esta ADR **no** deroga: en el
plan Hobby de Vercel, Standard Protection no cubre el dominio de producción. Ese era
el motivo real de la regla de preview que aquí se elimina. Lo que cambia es dónde
vive la restricción: deja de ser una rama del código que bloquea al owner y pasa a
ser una comprobación del despliegue, porque el nivel de protección depende del plan
contratado y no de una propiedad que el runtime pueda leer. Declarar `protected` en
una producción no protegida pone los datos reales en una URL pública.

Por eso el orden del checklist es: confirmar la protección del dominio, después
declarar `protected`, no al revés.

### Lo que no cambia

- El modo se resuelve en el request, nunca en build (ADR 0005). Un artefacto sigue
  sirviendo o negando según el entorno que lo corre.
- `locked` sigue siendo una negativa sin dataset de reemplazo.
- La composición sigue fallando cerrada con `RuntimeLockedError`.
- `DATABASE_URL` pooled sigue siendo parte de la definición de `personal`, y
  `DATABASE_DIRECT_URL` sigue siendo exclusiva del job de migración.
- Sigue sin haber autenticación, cuentas ni roles dentro de la aplicación.

## Consecuencias

- `src/modules/configuration/domain/config-health.ts` pierde la rama
  `isProtectedPreview`.
- Los tests que hoy afirman que producción de Vercel queda trabada cambian de
  sentido: pasan a afirmar que producción **con acceso declarado** sirve, y que
  producción **sin** acceso declarado sigue trabada. Están en
  `config-health.test.ts` y en `runtime-composition.test.ts`, que cubre los cinco
  selectores contra entornos trabados.
- El despliegue remoto exige PostgreSQL hosteada. Es una dependencia estructural
  nueva y necesita su propia decisión antes de contratarla.
- `TM-14` —protección del preview personal— deja de estar `contracted` y pasa a ser
  exigible en el momento del primer despliegue.

## Alternativas descartadas

**Verificar la protección desde la aplicación.** Vercel no expone un estado
confiable de Deployment Protection al runtime, y aproximarlo con heurísticas de
headers produciría una falsa sensación de garantía: el modo diría "probé que estoy
protegido" cuando en realidad adivinó.

**Autenticación de aplicación.** Resolvería el problema de verdad, pero contradice
el guardrail de alcance de la ADR 0004 —sin cuentas, sin roles, sin multi-tenancy—
por un único usuario. La protección de la plataforma cubre el caso con menos
superficie.

**Seguir usando URLs de preview.** Es lo que el código permite hoy. Cambian con cada
deployment, no son un destino estable y empujan a compartir enlaces de vida corta.
