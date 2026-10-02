# ADR 0032: datasets de Damodaran como releases de referencia

- Estado: aceptado
- Fecha: 2026-10-02
- Alcance: `F3-04`. Decide qué datasets de Damodaran entran, con qué derechos,
  cómo se descargan y guardan, y desde cuándo se conocen.
- Decisiones relacionadas: [ADR 0009](0009-egress-boundary.md) (una sola puerta
  de salida), [ADR 0020](0020-source-daily-budget-kill-switch.md) (cuota diaria),
  [ADR 0026](0026-daily-prices-source.md) (`owner_accepted`),
  [ADR 0027](0027-cedear-registry-sources.md) (disponibilidad igual a la
  observación), [ADR 0031](0031-on-demand-company-assessment.md) (evaluación a
  demanda)

## Contexto

El costo de capital bottom-up de `F3-06` necesita cuatro parámetros fechados: la
ERP implícita del mercado, la beta desapalancada de la industria, el riesgo país
y el spread de default por rating sintético. Damodaran publica los cuatro y la
metodología ya lo cita como referencia. La fuente estaba en `rights_review_pending`.

Los [términos del sitio](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/guide.html),
leídos el 2026-10-02, son dos pedidos: no explotar comercialmente los datos
revendiéndolos, y reconocer su origen. Autorizan el uso «as part of your regular
occupation or research». No dicen nada sobre descargarlos con un programa.

## Decisión 1 — derechos

El owner eligió el 2026-10-02 `owner_accepted` acotado para el acceso
automatizado. El resto se lee de los términos: uso personal, guardado
normalizado, derivados y export propio con atribución son `allowed`; la página
cruda, la exhibición pública y la transferencia a IA quedan `restricted`. La fila
es `approved_personal`.

## Decisión 2 — cuatro páginas HTML, una request cada una

| Dataset                       | Página          | Qué aporta                                                                          |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `damodaran.betas-us`          | `Betas.html`    | beta desapalancada corregida por caja, D/E y tasa efectiva por industria de EE. UU. |
| `damodaran.country-risk`      | `ctryprem.html` | rating soberano, default spread, CRP y ERP por país                                 |
| `damodaran.implied-erp`       | `histimpl.html` | ERP implícita y tasa del bono del Tesoro a inicio de cada año                       |
| `damodaran.synthetic-ratings` | `ratings.html`  | cobertura de intereses → rating → spread, para no financieras grandes y financieras |

Se lee la versión **HTML**, no el `.xls`: es la misma tabla con los mismos
encabezados, y el binario pediría una dependencia nueva. El parser
(`damodaran-html-1.0.0`) verifica los encabezados antes de leer una fila y rechaza
la página entera si una columna se corre, si la tabla viene truncada o si falta
una fila testigo. `NA` es `null`; un porcentaje se convierte a fracción moviendo
el punto, sin pasar por `number`.

La ERP mensual sólo se publica como `.xlsx` y queda afuera: la ERP es la de
inicio de año, con su fecha a la vista.

La allowlist abre las cuatro rutas, no el directorio. El tope diario es 20
requests y el ritmo una por segundo.

## Decisión 3 — releases con disponibilidad igual a la observación

Cada página publica un mes («Data used is as of January 2026») y corrige filas a
mitad de ciclo («Turkey (updated February 2026)»). Fechar la release en enero
sería look-ahead para esa fila. Como en el registro CEDEAR, `validFrom` y
`availableAt` son la observación, y la etiqueta publicada se guarda sólo para
leer. Un corte anterior a la primera captura no tiene parámetros y lo dice.

Una release es la tabla entera (`reference_dataset_releases` más
`reference_dataset_rows`, migración `0023`). La misma publicación no escribe nada
(corrida `duplicate`); otra supersede a la vigente en la observación. La clave de
idempotencia de la corrida es la **transición** —contenido más release que
reemplaza—, para que un contenido que vuelve después de otro sea una release y no
un replay. Ninguna página se guarda ni se commitea; las fixtures son sintéticas.

## Consecuencias

- Medido el 2026-10-02: 96 industrias, 178 países, 66 años y 30 bandas, sin
  rechazos; 240 kB en la base personal y 9 requests contando un dry run y una
  verificación de idempotencia.
- Las betas son de EE. UU.: una empresa del índice con operaciones globales
  usa la beta de su industria norteamericana y lo declara su nivel de rigor.
- La revisión de derechos vence el 2027-01-31, antes de la actualización anual.
