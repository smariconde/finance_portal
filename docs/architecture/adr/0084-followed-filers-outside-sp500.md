# ADR 0084: empresas fuera del S&P 500 que presentan 10-K, constituidas a pedido

- Estado: aceptada el 2026-11-18 por el owner (decisión 2: opción 1);
  implementada en `F6-33` el 2026-11-19 (migración `0056`)
- Fecha: 2026-11-18
- Alcance: slice a abrir en Fase 6 (valuación por ticker).
- Relacionadas: [ADR 0007](0007-ticker-driven-valuation-pivot.md) (alcance
  inicial S&P 500), [ADR 0016](0016-analysis-scope-sector-matrices.md)
  (fundamentals por ticker valuado), [ADR 0027](0027-cedear-registry-sources.md)
  (registro CEDEAR), [ADR 0051](0051-on-demand-valuation-data.md) (datos a
  pedido del job).

## Contexto

El portal sólo valúa empresas del S&P 500: el universo se constituye desde esa
lista y el registro CEDEAR sólo guarda programas cuyo subyacente ya está en el
grafo. Para un inversor que compra por CEDEAR —y por Schwab desde `F11-03`— eso
deja afuera nombres que el owner mira.

Lo medido el 2026-11-18 con los comandos del repo, sin guardar payloads en el
repositorio:

- **Registro CEDEAR en seco** (`pnpm cedears:record`, 2 requests): Comafi lista
  369 filas y resuelve 154; Caja, 59 y resuelve 8. Quedan **239 subyacentes
  `symbol_not_in_universe`**, 23 `foreign_market` (acciones de B3 y Xetra) y un
  programa de deuda.
- **Qué presenta cada uno a la SEC** (289 requests: la tabla de tickers, un
  `submissions` por emisor y un `companyconcept` `ifrs-full/Revenue` por cada
  20-F/40-F):

  | Grupo                                        | Cantidad | Ejemplos                               |
  | -------------------------------------------- | -------: | -------------------------------------- |
  | 10-K con 10-Q                                |       63 | MELI, SNOW, SHOP, PINS, RBLX, TEAM, ZM |
  | — de ellos, trusts de commodities o cripto   |      ~11 | GLD, SLV, IBIT, USO, DBA               |
  | 20-F con `ifrs-full/Revenue`                 |       71 | TSM, NU, VIST, SAP, NVO, PBR, VALE     |
  | 20-F sin ese concepto (US GAAP o banco IFRS) |       33 | BABA, ASML, PDD, HSBC, BBVA            |
  | 40-F                                         |        6 | B, AEM, CCJ, KGC                       |
  | Sin anual en la SEC (ETF, OTC, sin CIK)      |       66 | SPY, QQQ, XLK, EWZ                     |

- **Modelo de identidad.** La resolución de un subyacente CEDEAR y la del job
  buscan por símbolo en **todo** el grafo; la pertenencia al índice es una
  dimensión versionada aparte (`index_memberships`). Una empresa con entidad,
  security, listing, símbolo y CIK resuelve aunque no pertenezca al S&P 500.
- **Volumen.** El universo completo midió 245 MB en una réplica (ADR 0016):
  ~0,5 MB por empresa valuada, que sólo se gastan cuando se valúa.

Las ~52 operativas con 10-K usan el mismo cable que ya se lee: `companyfacts`
en `us-gaap`, 10-Q para el TTM y 10-K para las tareas de IA. Los 20-F son otro
problema: taxonomía `ifrs-full`, interinos en 6-K sin XBRL, moneda funcional
distinta del dólar y otro formato de documento para las secciones.

## Decisión 1 — primero sólo emisores que presentan 10-K

Se amplía a empresas que presentan **10-K y 10-Q** a la SEC. 20-F y 40-F quedan
para su propia ADR, con su propia medición. Los trusts de commodities o cripto
presentan 10-K, pero no tienen negocio que valuar: el selector de método los
niega con motivo (`unsupported`), nunca con un número.

## Decisión 2 — la constitución es a pedido desde `/valuacion`

El owner eligió la opción 1 el 2026-11-18. Las tres se registran por trazabilidad.

Opciones:

1. **A pedido desde `/valuacion`** (recomendada). Si el ticker no está en el
   grafo, el job lo busca en `company_tickers_exchange.json`, confirma un 10-K
   en `submissions` —un request que el job ya hace por el SIC— y constituye
   entidad, security, listing, símbolo y CIK antes del paso de datos. Encaja con
   la ADR 0051 y con no gastar por adelantado. Sirve también para acciones sin
   CEDEAR que el owner opera por Schwab.
2. **Lote desde el registro CEDEAR.** Un comando constituye los ~52 de una vez.
   Gasta cuota y espacio en empresas que quizá nunca se valúen.
3. **Lista declarada por el owner** en el código, como las sucesiones. Es
   explícita, pero cada empresa nueva pide un cambio en el repositorio.

## Decisión 3 — un índice declarado propio, nunca el S&P 500

Una empresa constituida así recibe pertenencia a un índice nuevo,
`owner-followed`, abierto en el instante de la constitución y nunca cerrado por
un rebalanceo del S&P 500. Ninguna lectura del S&P 500 la ve:

- **Sector.** No tiene el sector de `sp500-wikipedia-gics-sector`: la matriz y
  las divergencias siguen siendo del S&P 500, y en la página su sector es `null`
  con motivo.
- **Contexto de pares** (`valuation-peer-context-1.0.0`). Entra en la mediana
  de «todo lo valuado» y no en la de un sector.
- **CEDEAR.** La próxima corrida de `pnpm cedears:record --apply` resuelve su
  programa sin cambiar el resolvedor.

## Consecuencias

- `/valuacion` acepta cualquier ticker con 10-K y niega por nombre a un 20-F, a
  un 40-F o a un símbolo sin CIK.
- El job suma un paso de constitución con su propia versión y su auditoría
  point-in-time; la disponibilidad de la identidad es la observación, como en el
  registro CEDEAR.
- El universo deja de ser sinónimo del S&P 500: las lecturas que hoy cargan
  `sp-500` para resolver identidad tienen que nombrar qué índice quieren.
- Pendiente con su propia ADR: 20-F en IFRS y en US GAAP, empezando por los que
  el owner pida (NU, VIST, TSM, MELI ya entra por 10-K).

## Implementación (`F6-33`)

- `followed-filer-eligibility-1.0.0` es la regla pura. Asigna el ticker con
  `constituent-match-1.0.0`, sin una regla propia. Después exige que el último
  informe anual original sea un 10-K o un 10-KT de hace 18 meses o menos.
- El ticker llega de un request del owner, pero no elige qué se baja: elige
  como mucho **una** empresa que la SEC ya asigna, con dos requests medidos y
  los derechos revisados antes de la red (`TM-03`, `TM-08`, `TM-15`). Sólo
  constituye un job pedido por el owner, nunca uno que sigue a otro.
- El planner sólo agrega (`membershipPolicy: "additive"`). Un rebalanceo del
  S&P 500 lee sólo sus propias membresías, así que nunca cierra una de
  `owner-followed`.
- A su propio corte la empresa todavía no existía. Por eso el job termina
  `identity_constituted`, y el seguimiento la resuelve con un corte nuevo y
  puede bajar sus datos.
