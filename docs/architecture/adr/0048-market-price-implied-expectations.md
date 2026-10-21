# ADR 0048: precio de mercado y expectativas implícitas sobre la corrida registrada

- Estado: aceptado
- Fecha: 2026-10-21
- Alcance: `F6-09`. Revierte la decisión del owner de `F6-03` («sin precio de
  mercado ni upside»). No cambia el snapshot, el motor ni los hashes.
- Decisiones relacionadas: [ADR 0026](0026-daily-prices-source.md) (serie
  cruda), [ADR 0046](0046-derived-valuation-assumptions.md) (la regla que
  armó los supuestos), [ADR 0047](0047-valuation-run-history.md)

## Contexto

Con la primera corrida real a la vista, AAPL vale 143,82 USD y cotiza a
333,02 USD el mismo día. El owner pidió ver el precio: un valor sin el precio
al lado no sirve para decidir, y una diferencia de 2,3 veces sin explicación
tampoco. La pregunta útil no es «¿cuánto vale?» sino «¿qué tiene que creer el
mercado para pagar este precio, y es creíble?».

## Decisión 1 — el precio es el cierre crudo al `as_of` de la corrida

`market-price-comparison-1.0.0` lee de `security_prices` el cierre del mismo
día que el `as_of` de la corrida, que el job ya fija como la última rueda
guardada al corte. Ningún otro día lo reemplaza (`no_close_at_as_of`), la
moneda tiene que coincidir, y un split con fecha entre la base de acciones de
la corrida —la más vieja entre la carátula y el cierre del ejercicio base— y
el cierre la anula (`split_after_share_basis`): precio y valor hablarían de
acciones distintas. Un cierre guardado posterior se muestra aparte, con su
fecha, y no se compara: la corrida no lo vio.

Publica `precio ÷ valor` y `valor ÷ precio − 1`, sin colores de compra o venta
y sin la palabra «upside».

## Decisión 2 — un DCF inverso por driver, con el mismo motor

`market-implied-1.0.0` resuelve, para cada uno de cuatro drivers, el valor
que hace que `computeFcff` devuelva el precio **moviendo sólo ese driver**:

| Driver                | Qué se mueve                                      | Intervalo                   |
| --------------------- | ------------------------------------------------- | --------------------------- |
| Crecimiento de ventas | años 1–5, con la convergencia de la regla en 6–10 | −30 % a 60 %                |
| Margen EBIT           | todos los períodos y el terminal                  | 0 % a 95 %                  |
| ROIC terminal         | la reinversión que sostiene `g`                   | `max(g, 0) + 0,1 %` a 500 % |
| Tasa de descuento     | una tasa única para todos los períodos            | `g + 0,5 %` a 30 %          |

La resolución es por bisección con 48 pasos fijos, publicada a seis
decimales. Si el precio queda fuera de lo que el driver alcanza dentro del
intervalo se dice de qué lado y con qué valor en el borde
(`price_above_range`, `price_below_range`): nunca se extrapola. El crecimiento
sólo se mueve sobre un snapshot con la forma de la regla derivada; en otro,
`growth_shape_unsupported`.

Moverlos de a uno es la decisión: combinarlos exige elegir cuál se mueve y
cuánto, y esa es una opinión de quien lee, no de la regla.

Cada fila va al lado de lo que la empresa ya mostró en lo guardado —el CAGR de
la historia congelada en dos ventanas, el margen y el ROIC ajustados del año
base, el costo del equity—, sin una fuente nueva.

## Decisión 3 — se calcula al leer y no se registra

Son funciones puras del snapshot guardado y de la serie de precios: se
recalculan en el render (~100 ms medidos sobre AAPL), no pasan por los
policy checks y no entran a `valuation_runs`. Un cambio de regla cambia la
lectura de todas las corridas, cosa aceptable porque no es un resultado de
la corrida sino una pregunta sobre ella; la versión viaja en la página.

## Consecuencias

- Medido sobre la corrida real de AAPL (2026-09-30, 333,02 USD): el precio
  exige 25,49 % de crecimiento anual cinco años (la corrida usa 8,68 %; los
  últimos tres años fueron 1,81 %), o un margen de 77,83 % (34,25 % ajustado),
  o descontar a 5,74 % (costo del equity 10,04 %). El ROIC terminal solo no
  alcanza: aun con 500 % el valor llega a 213,63 USD.
- Esa lectura dice dónde mirar: la corrida supone que AAPL no tiene retornos
  en exceso después del año 10 (ROIC terminal = WACC, ADR 0046) y su ROIC
  ajustado es 82 %. Revisar esa regla es `F6-10`.
- La lectura cualitativa —si lo que el precio exige es creíble— no la hace el
  código: es `F6-11`, una tarea de la IA con evidencia citada que nunca mueve
  el valor.
- La fuente sigue siendo `owner_accepted` (ADR 0026): la superficie es
  personal y lo dice.

## Alternativas descartadas

**Guardar el precio en el snapshot.** Cambiaría el hash de cada corrida y
mezclaría el mercado con los supuestos; el precio no es un input del valor.

**Un solo «crecimiento implícito» como en un reverse DCF de manual.** Esconde
que el mismo precio se explica por margen, por reinversión o por tasa, y cada
uno se refuta con evidencia distinta.

**Resolver con Newton.** Más rápido, pero su convergencia depende del punto de
partida y de la derivada; la bisección con pasos fijos es determinista y
alcanza.
