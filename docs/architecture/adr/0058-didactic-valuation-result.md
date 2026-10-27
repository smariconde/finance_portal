# ADR 0058: el resultado de la valuación se lee de la decisión a la auditoría

- Estado: aceptado
- Fecha: 2026-10-26
- Alcance: `F6-17`, `/valuacion/[ticker]`. No cambia el snapshot, el motor, la
  metodología ni los hashes de ninguna corrida.
- Decisiones relacionadas: [ADR 0046](0046-derived-valuation-assumptions.md)
  y [ADR 0049](0049-derived-assumptions-v2.md) (la regla que arma los
  supuestos), [ADR 0048](0048-market-price-implied-expectations.md) (precio y
  DCF inverso), [ADR 0050](0050-market-expectations-reading.md) (lectura del
  10-K), [ADR 0017](0017-sec-history-window.md) (ventana de cinco ejercicios)

## Contexto

El owner valuó AAPL y AMZN y no pudo leer el resultado. La página medía 13.370
px en escritorio, con 15 tablas, 656 celdas, 5.352 palabras y 69 etiquetas de
versión. La primera pantalla mostraba el valor y, al lado, el contrato
point-in-time y los hashes, pero no el precio. La conclusión útil —el precio
de AAPL exige que las ventas crezcan 18 % por año cuando venían creciendo
7 %— estaba en el segundo bloque, en una tabla técnica. Tampoco se veía cómo
venía la empresa: la página mostraba supuestos, pero no la historia de la que
salían.

El owner pidió entender si una acción está cara o barata y por qué, y aprender
a leer un análisis. Eligió tres cosas el 2026-10-26: auditoría plegada al
final de la misma página, explicaciones breves siempre visibles y gráficos
chicos con su tabla equivalente.

## Decisión 1 — el orden es de la decisión a la auditoría

La página se lee en este orden:

1. **Precio contra valor.**
2. **Qué tendría que pasar** para pagar el precio.
3. **Cómo viene la empresa.**
4. **Por qué el modelo da ese valor.**
5. **Escenarios y sensibilidad.**
6. **CEDEAR.**
7. **Auditoría de la corrida.**
8. **Historial.**

El encabezado conserva fecha, método en palabras y rigor. El listing, el CIK y
el registro bajan a la auditoría.

La auditoría reúne todo lo que la página mostraba antes, sin quitar nada: el
contrato y los hashes, la regla y el libro de ajustes, la proyección año por
año, el costo de capital, las decisiones cualitativas, el puente, el rigor, la
evidencia y los controles. Son nueve `<details>` nativos, cerrados por
defecto, y se abren con teclado o click. Un ancla que apunta a uno lo abre,
así que «Rigor» y un enlace compartido no caen en un bloque cerrado. Si la
corrida fue rechazada, el primero arranca abierto, porque ahí está el motivo.

## Decisión 2 — el veredicto es una ubicación, no una recomendación

`valuation-verdict-1.0.0` ubica el cierre del día de la valuación
(`market-price-comparison-1.0.0`) respecto del rango de la corrida:

| Zona           | Dónde queda el precio                 |
| -------------- | ------------------------------------- |
| `below_bear`   | por debajo del escenario pesimista    |
| `bear_to_base` | entre el pesimista y el valor central |
| `base_to_bull` | entre el valor central y el optimista |
| `above_bull`   | por encima del escenario optimista    |

Los bordes son inclusivos hacia el valor central. Sin escenarios dice
«por encima», «igual» o «por debajo» del valor, y no publica zona.

Cada zona se explica en una frase que describe y nunca aconseja. «Barata»,
«cara», «comprar» y «vender» no aparecen.

La barra dibuja precio, valor y rango sobre una escala con 8 % de margen. El
dibujo es `aria-hidden`: la misma información está escrita en la frase y en
la leyenda. Sólo el precio lleva rótulo sobre la barra, para que dos marcas
cercanas no se pisen en un celular.

Cuando la corrida usa supuestos derivados, la página agrega un párrafo sobre
cómo leer la brecha. La regla proyecta la historia sin sorpresas: crecimiento
de tendencia que se apaga hasta la tasa libre de riesgo, y el margen del
último año. Por eso, en las empresas que el mercado considera de calidad, el
valor suele quedar debajo del precio. Lo que importa es qué exige el precio,
más que el tamaño de la brecha.

## Decisión 3 — lo que exige el precio se dice en palabras

Las cuatro lecturas del DCF inverso (ADR 0048) se escriben como alternativas,
porque cada una mueve un solo supuesto:

- que las ventas crezcan X % por año;
- o que el margen pase a Y %;
- o que lo reinvertido rinda Z %;
- o aceptar ganar W % por año.

La tasa se presenta como la TIR que paga el precio si los flujos del modelo
se cumplen. Al lado de cada una va lo que mostró la empresa y, si existe la
lectura de la IA, qué sostiene el 10-K. La tabla técnica y las citas quedan a
demanda en dos `<details>`.

## Decisión 4 — la historia es reportada y se lee al corte de la corrida

`company-trajectory-1.0.0` lee la misma serie anual que leyó la evaluación de
la corrida (`readAnnualFundamentals`), con el corte de conocimiento de la
corrida. Una publicación posterior no aparece. Publica seis métricas por
ejercicio:

| Métrica             | Fórmula                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Ventas              | ventas reportadas                                                                         |
| Margen operativo    | `ebitOf` ÷ ventas, con la misma regla de EBIT del motor                                   |
| Ganancia por acción | ganancia neta ÷ acciones diluidas promedio                                                |
| Flujo de caja libre | flujo operativo − compras de propiedad, planta y equipo                                   |
| Caja neta           | caja + inversiones líquidas + valores negociables no corrientes − deuda (`reported-debt`) |
| Acciones diluidas   | acciones diluidas promedio                                                                |

A eso suma tres resúmenes entre extremos: el crecimiento compuesto de las
ventas, los puntos de margen y la variación de las acciones.

Es la lectura **reportada**. No capitaliza arrendamientos ni I+D, no revierte
cargos ni resta opciones, así que su margen puede diferir del ajustado de la
corrida, y la página lo dice. Acciones y EPS quedan en la base de splits
vigente al corte, como los entrega el lector del linaje.

Ningún faltante es cero:

- sin capex no hay flujo libre;
- sin receta de deuda no hay caja neta;
- con monedas distintas no hay comparación.

Cada caso queda nulo con su motivo. Una tasa compuesta exige extremos
estrictamente positivos y dos ejercicios separados por al menos un año.

Los ejercicios en los que no hay ninguna de las seis lecturas no se muestran:
son los que la serie trae sólo por la ventana de I+D (ADR 0037).

Cada métrica tiene un gráfico chico de barras desde cero, sin tooltip. Lleva
su cifra escrita, el último año resaltado por opacidad y una frase de lectura
que también es su nombre accesible. Una sola tabla repite las cifras con
cada nulo y su motivo.

## Decisión 5 — el valor se cuenta como una cadena de pasos

`value-chain-1.0.0` agrupa lo que la corrida ya calculó en seis pasos:

1. ventas proyectadas;
2. ganancia operativa;
3. flujo libre después de impuestos y reinversión;
4. valor presente de los años explícitos;
5. valor terminal y su peso, y probabilidad de quiebra;
6. puente al patrimonio y división por acciones.

No recalcula nada: suma los valores presentes que el motor guardó. Un test
verifica que lo explícito más lo terminal es el valor en marcha y que el
puente cierra con el patrimonio.

Los montos grandes se escriben en palabras con la escala larga del castellano
(`formatCompactAmount`: 2,64 billones, 416,16 mil millones). Las cifras
exactas siguen en la auditoría.

## Decisión 6 — los textos del snapshot se traducen al mostrarlos

Las tesis de escenario, los motivos de las ausencias y las reglas de los
controles están en inglés dentro del snapshot y del resultado, y forman parte
de sus hashes. No se reescriben. La página los traduce por coincidencia exacta
del cuerpo y deja al final la versión de la regla que los escribió. Un texto
desconocido se muestra tal cual.

El resumen y las citas de la IA quedan en inglés: las citas son literales del
10-K, y cambiar el idioma del resumen es otra versión de la tarea.

## Consecuencias

- En escritorio la página pasa de 13.370 a unos 7.400 px y de unas 5.350 a
  unas 3.150 palabras visibles, con la misma información disponible.
- El render sigue siendo sólo lectura. Suma una lectura de observaciones por
  corrida mostrada; no sale a la red ni llama al modelo.
- Los conceptos aparecen explicados donde se usan. Eso adelanta `EDU-01`, que
  sigue abierto para el glosario versionado, su página de referencia y el
  test que recorre la superficie.
- La comparación con el sector y con todo lo valuado no está acá: necesita
  corridas de los pares y es `F6-19`.
