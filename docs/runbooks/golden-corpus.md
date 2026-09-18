# Corpus congelado de la SEC

- Slice: `F2-06`
- Decisiones: [ADR 0023](../architecture/adr/0023-frozen-sec-extracts-rights.md)
  (derechos y exposición)
- Runtime: personal local o protegido, con PostgreSQL

El corpus es el segundo oráculo de regresión de los parsers de la SEC. El filer
sintético prueba que el parser hace lo que creemos; el corpus prueba que el cable
es como creemos, con números que se reconcilian contra el filing.

Vive en
[`src/modules/fundamentals/infrastructure/golden/`](../../src/modules/fundamentals/infrastructure/golden/),
está fijado por `sha256` en su manifiesto, y **no vuelve a la red**: ningún test
descarga nada, y Prettier tiene el directorio excluido para no reescribirlo.

## Qué hay adentro y por qué

Seis filers, los del conjunto seguido, elegidos como arquetipos distintos:

| CIK          | Filer                    | Qué aporta que los otros no                                                         |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------- |
| `0000320193` | Apple                    | ejercicio fiscal cerrado en septiembre y el mismo período repetido por tres 10-K    |
| `0001045810` | NVIDIA                   | el 10:1 de 2024 re-expresando el EPS del ejercicio anterior sin borrar el original  |
| `0001652044` | Alphabet                 | un segundo split con otra razón, el 20:1 de 2022, para que la regla no se ate a una |
| `0001326160` | Duke Energy              | utility regulada, con el mayor número de conceptos descartados por la selección     |
| `0000034088` | ExxonMobil, CIK anterior | el filer que dejó de presentar y cuya historia vive en otro CIK                     |
| `0002115436` | ExxonMobil, CIK sucesor  | todavía sin cierre anual: su ancla cae en el último período, no en un 10-K          |

Ampliar el corpus es una decisión, no un descuido: el presupuesto declarado son
4 MB y hoy pesa 2,7.

## Actualizarlo

```sh
pnpm fixtures:capture                       # el conjunto y lo que pesaría, sin escribir
pnpm fixtures:capture --cik 320193          # un filer
pnpm fixtures:capture --apply               # baja y congela
```

Dos requests por filer —submissions y companyfacts— por el mismo egress medido que
una ingesta: el Fair Access de la SEC es sobre el ritmo y no distingue para qué se
baja. El comando pide explícitamente el derecho a conservar lo descargado, así que
si alguien devolviera `rawStorage` a `unknown` se niega antes de abrir un socket.

Capturar un filer **no borra** el resto: el manifiesto conserva las entradas que
no se volvieron a capturar.

Después de `--apply`, revisá el diff. Un cambio esperable es que aparezcan
presentaciones y hechos nuevos; uno que no lo es —un valor viejo que cambió, una
unidad que desapareció— merece mirarse antes de commitear.

## Cuando un test del oráculo falla

Los números de
[`golden-sec-oracle.test.ts`](../../src/modules/fundamentals/infrastructure/golden-sec-oracle.test.ts)
están commiteados a propósito. Si uno se mueve, la pregunta no es cómo arreglar el
test:

1. **¿Cambió el corpus?** Si acabás de correr `--apply`, sí: el diff dice qué. Un
   conteo que sube porque el filer presentó un 10-K nuevo es esperable; actualizá
   el número esperado en el mismo commit que el corpus.
2. **¿Cambió el parser?** Si el corpus está intacto —el test de integridad pasa— y
   los conteos se movieron, lo que cambió es nuestro código. Puede ser correcto,
   pero es un cambio de comportamiento sobre datos reales y va explicado.
3. **¿Falla la integridad?** `golden-sec-corpus.test.ts` compara bytes y `sha256`.
   Si falla, alguien editó un archivo a mano o lo reformateó. Restaurá desde git;
   el corpus no se edita.

## Lo que el corpus no es

- **No es un recording.** Es un extracto elegido y reducido por una versión
  declarada del reductor, con manifiesto. Un payload íntegro de una corrida
  personal no cumple nada de eso y sigue prohibido en este repositorio.
- **No es un dataset.** No alimenta ninguna superficie ni ninguna ingesta: sólo lo
  leen tests.
- **No es la reconciliación de Fase 2.** El gate pide 30 empresas de arquetipos
  distintos reconciliadas contra su filing y una validación semántica XBRL de
  muestra. El corpus es la infraestructura que esa reconciliación va a usar.
