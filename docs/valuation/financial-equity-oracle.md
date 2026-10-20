# Referencia independiente del exceso de retorno financiero

- Fecha: 2026-10-20
- Slice: `F4-06`, bancos y aseguradoras; estado `experimental`
- Decisión: [ADR 0041](../architecture/adr/0041-financial-equity-excess-return.md)
- Test: `src/modules/valuation/domain/excess-return-oracle.test.ts`

## Procedimiento

Se consultó la [planilla pública eqexret.xls](https://www.stern.nyu.edu/~adamodar/pc/eqexret.xls),
enlazada desde el [catálogo de Damodaran](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/eqspread.htm).
La descarga de investigación tiene 45.568 bytes y SHA-256
`0556d0aa4394c9d7223988dca2d80443e0acd9f85643b5994a321280729ea91d`.
Se convirtió con LibreOffice headless en un perfil temporal para inspeccionar
las fórmulas y sus valores evaluados. El libro permanece fuera del repositorio:
se versiona la comparación numérica, no un payload ni un nuevo provider.

Las expectativas del test se transcribieron de esa evaluación. El test no lee
el libro, no abre red ni genera los números esperados con el motor bajo prueba.

## Inputs y mapa de celdas

Montos del libro en millones; el test convierte patrimonio y acciones a unidades.

| Hoja / celda     | Concepto                         | Valor       |
| ---------------- | -------------------------------- | ----------- |
| Inputs B3        | Patrimonio inicial               | 17.997      |
| Inputs B6        | Acciones en millones             | 1.120,713   |
| Inputs B11 / B12 | Libre de riesgo / ERP            | 5 % / 4 %   |
| Inputs B10 / B38 | Beta inicial / terminal          | 1,15 / 1,10 |
| Inputs B15       | Horizonte                        | 10 años     |
| Inputs B22 / B26 | ROE inicial / terminal           | 25 % / 15 % |
| Inputs B5 / B4   | DPS / EPS para el payout inicial | 0,92 / 4,75 |
| Inputs B31       | g terminal                       | 5 %         |

Se mantiene la trayectoria inicial durante cinco años y se hace la convergencia
lineal durante los cinco restantes: ROE, beta y payout. El payout terminal es
`1 - 0.05 / 0.15`. No hay CRP ni opciones en esta comparación explícita.
El input del test identifica una institución sintética; no afirma que esos
números sean una valuación vigente de una empresa.

## Resultados esperados

Hoja «Excess Return Valuation»:

| Celdas | Concepto                          | Valor en la unidad del libro |
| ------ | --------------------------------- | ---------------------------- |
| B10    | Exceso del año 1                  | 2.771,538                    |
| K10    | Exceso del año 10                 | 3.913,07490884859            |
| L10    | Exceso terminal                   | 4.108,72865429103            |
| K11    | Valor terminal antes de descuento | 93.380,1966884324            |
| B27    | Equity total                      | 83.990,7586682787            |
| B29    | Valor por acción, USD             | 74,9440389004845             |

Los diez excesos anuales se comparan individualmente con tolerancia de USD 0,01
al convertirlos de millones a unidades. El valor por acción se compara a diez
decimales. La diferencia residual esperable es la aritmética binaria de la
planilla frente a la política decimal128 del portal; no se redondea entre años.

## Convenciones comprobadas

El libro obtiene `L15` con `MAX(B15:K15) × (1 + g)`. En su ejemplo el patrimonio
crece y el año 10 ya tiene ROE y payout estables: esa expresión coincide con el
**cierre del año 10**. El portal usa directamente ese cierre como inicio del
terminal, incluso si cambia la trayectoria; evita depender del máximo histórico
o aplicar `g` dos veces. Un test con payout terminal distinto del último payout
explícito conserva esta convención.

Un segundo oráculo sintético reconcilia por DDM: patrimonio inicial 100,
ROE de 12 % por dos años, payout 50 %, Ke 10 %, ROE terminal 10 % y g 3 %.
El exceso de retorno da `100 + 2/1.1 + 2.12/1.21`; el DDM descuenta 6 y 6,36,
más el terminal de distribuciones sobre patrimonio 112,36. Ambos dan
103,5702479339. Si ROE = Ke en todos los años, el valor es exactamente 100.
Estos casos evitan depender sólo de una hoja pública con la misma convención.
