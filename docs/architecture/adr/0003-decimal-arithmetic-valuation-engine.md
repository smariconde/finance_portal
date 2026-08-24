# ADR 0003: aritmética decimal del motor de valuación

- Estado: aceptado
- Fecha: 2026-08-24
- Alcance: Fase 1 `F1-05`
- Decisiones relacionadas: [ADR 0001](0001-stack-cache-postgres.md),
  [metodología de valuación](../../valuation/methodology.md) y
  [contrato point-in-time](../../data/point-in-time-contract.md)

## Contexto

`F1-05` implementa el primer motor determinista: FCFF base con sensibilidad,
snapshot de entrada y hash reproducible. El motor necesita sumar, multiplicar,
dividir y elevar a potencias sobre montos financieros y tasas.

El repositorio ya trata los valores financieros como strings decimales
canónicos. `staged_record`, `observation` y `depositary_ratio` los validan con un
regex y PostgreSQL los persiste como `numeric`. Nada convierte un importe a
`number` binario en ninguna frontera, porque `0.1 + 0.2 !== 0.3` en IEEE-754 y un
hash calculado sobre el resultado de esa suma no sería reproducible entre
plataformas ni entre versiones del runtime.

El motor es el primer componente que además de transportar decimales debe
**operar** con ellos. Dos requisitos del slice dependen de esa aritmética:

- el mismo input canónico debe producir el mismo resultado y el mismo hash;
- una división inválida, un `NaN` o un `Infinity` deben producir un error de
  policy, no un valor degradado.

`docs/valuation/methodology.md` ya fijó la política numérica —`precision=34` y
`ROUND_HALF_EVEN`, equivalentes a decimal128 para los fines del motor— y anticipó
Decimal.js sin instalarlo. Esta decisión cierra ese pendiente.

## Decisión

### Librería

Se incorpora `decimal.js` como dependencia de producción del dominio de
valuación.

- Sin dependencias transitivas: el árbol de instalación no crece.
- Sin código nativo ni build step: instala igual en Windows, CI y Vercel.
- La precisión y el modo de redondeo son configuración explícita del constructor,
  no un default global mutable.
- `Decimal.clone()` produce un constructor aislado: cambiar la configuración de
  otro consumidor no puede alterar la del motor.

### Configuración del motor

El módulo `src/modules/valuation/domain/decimal-policy.ts` es el **único** lugar
que importa `decimal.js`. Exporta un constructor clonado y las funciones que el
resto del dominio usa; ningún otro archivo instancia un `Decimal` directamente.

| Parámetro   | Valor             | Motivo                                          |
| ----------- | ----------------- | ----------------------------------------------- |
| `precision` | `34`              | dígitos significativos de decimal128            |
| `rounding`  | `ROUND_HALF_EVEN` | banker's rounding: no sesga una serie de flujos |
| `toExpNeg`  | `-9e15`           | `toString()` nunca emite notación exponencial   |
| `toExpPos`  | `9e15`            | idem para magnitudes grandes                    |

`toExpNeg` y `toExpPos` no son cosméticos: la serialización canónica de
`content-hash.ts` recibe strings, y un valor que a veces se imprime `1e+21` y a
veces `1000000000000000000000` produciría dos hashes para el mismo número.

La precisión y el modo de redondeo forman parte de `engine_version` y quedan
persistidos en cada corrida. Cambiarlos es un cambio material: incrementa la
versión y no reescribe corridas históricas.

### Fronteras

- Los decimales cruzan cada frontera como string canónico. Una instancia de
  `Decimal` nunca se serializa, no entra en un hash, no se persiste y no llega a
  un Client Component. `canonicalize()` ya rechaza objetos que no sean planos, de
  modo que un escape accidental falla en vez de degradar.
- El redondeo ocurre en bordes de presentación o por una regla contable
  documentada, nunca entre pasos del cálculo.
- `decimal.js` es una librería de aritmética pura: no lee entorno, no abre red y
  no requiere `server-only`. El dominio sigue sin importar React, Next.js,
  Drizzle ni SDKs de proveedores.
- Una división por cero, un no finito o un input fuera de rango producen
  `ValuationPolicyError` con código estable, nunca `NaN`, `Infinity` ni `null`.

## Consecuencias

### Positivas

- El motor es reproducible entre plataformas y versiones de Node.js.
- La política numérica queda declarada en un solo módulo y versionada junto al
  engine.
- El resto del dominio no conoce la librería: reemplazarla exigiría reescribir un
  archivo, no el motor.

### Costos y riesgos

- Una dependencia más que auditar y actualizar; su versión entra en el alcance de
  `TM-13`.
- `precision=34` es configuración compartida: un módulo que instancie su propio
  `Decimal` global obtendría otros resultados. El uso exclusivo desde
  `decimal-policy.ts` es la mitigación, y se verifica por revisión.
- `decimal.js` es más lento que la aritmética binaria. Es irrelevante para una
  grilla de sensibilidad acotada y debe medirse antes de habilitar un screener
  masivo o Monte Carlo.

## Alternativas descartadas

- **`number` de JavaScript:** no representa exactamente los importes reportados y
  rompe la reproducibilidad del hash. Descartado por el contrato, no por gusto.
- **`BigInt` con enteros escalados propios:** evita la dependencia, pero exige
  implementar división a 34 dígitos y `ROUND_HALF_EVEN` a mano. Más superficie de
  bug propia en el componente que menos puede tener uno, sin beneficio
  observable.
- **`big.js`:** más chica, pero sin precisión configurable por constructor ni
  potencia con exponente entero cómoda para el factor de descuento.
- **`decimal.js-light`:** descarta `pow`, `ln` y `exp`; el motor multi-etapa de
  Fase 4 los necesitará y migrar después sería otra decisión.
- **Aritmética decimal en PostgreSQL:** el dominio debe ser puro y testeable sin
  base. El modo demo ni siquiera abre una conexión.

## Verificación requerida

En este slice:

- tests de la política decimal: exactitud sobre casos que IEEE-754 falla,
  `ROUND_HALF_EVEN` en empates, ausencia de notación exponencial y rechazo de no
  finitos y de división por cero;
- el mismo input canónico produce el mismo `input_hash` y el mismo `result_hash`;
- `decimal.js` se importa exclusivamente desde `decimal-policy.ts`;
- format, lint, typecheck, unit, integration y build pasan.

Antes de ampliar el motor:

- comparar una corrida contra un cálculo independiente documentado;
- medir la grilla de sensibilidad antes de subir su límite de celdas.

## Fuentes primarias

- [decimal.js: documentación de la API](https://mikemcl.github.io/decimal.js/)
- [IEEE 754-2019 decimal128 (resumen de la especificación)](https://en.wikipedia.org/wiki/Decimal128_floating-point_format)
- [Damodaran: materiales y model chooser](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valuation/val.htm)

## Revisar esta decisión cuando

- el motor multi-etapa de Fase 4 necesite funciones fuera de la API usada;
- una medición muestre que la aritmética decimal domina el costo del screener;
- cambie la política numérica publicada en `docs/valuation/methodology.md`;
- aparezca en el runtime un tipo decimal nativo estandarizado y estable.
