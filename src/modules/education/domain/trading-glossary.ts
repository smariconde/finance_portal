import { defineGlossary, type GlossarySource } from "./glossary";

/**
 * Glosario de trading (`trading-glossary-1.0.0`, `F11-10`): los términos que
 * usan las lecciones, el diario y la cuenta. Cada definición cita al autor que
 * la fijó; cuando el proyecto decide una convención propia (R, el 6 %), cita la
 * ADR 0076 en vez de un libro.
 */
export const TRADING_GLOSSARY_VERSION = "trading-glossary-1.0.0";

export const TRADING_SOURCES: readonly GlossarySource[] = [
  {
    key: "nison-1991",
    citation:
      "Nison, S. (1991). Japanese Candlestick Charting Techniques. New York Institute of Finance.",
  },
  {
    key: "edwards-magee-1948",
    citation:
      "Edwards, R. D. y Magee, J. (1948). Technical Analysis of Stock Trends.",
  },
  {
    key: "murphy-1999",
    citation:
      "Murphy, J. J. (1999). Technical Analysis of the Financial Markets. New York Institute of Finance.",
  },
  {
    key: "wilder-1978",
    citation:
      "Wilder, J. W. (1978). New Concepts in Technical Trading Systems. Trend Research.",
  },
  {
    key: "appel-1979",
    citation:
      "Appel, G. (1979). The Moving Average Convergence-Divergence Trading Method.",
  },
  {
    key: "berkowitz-1988",
    citation:
      "Berkowitz, S. A., Logue, D. E. y Noser, E. A. (1988). The Total Cost of Transactions on the NYSE. Journal of Finance, 43(1).",
  },
  {
    key: "crabel-1990",
    citation:
      "Crabel, T. (1990). Day Trading with Short Term Price Patterns and Opening Range Breakout. Traders Press.",
  },
  {
    key: "bernard-thomas-1989",
    citation:
      "Bernard, V. L. y Thomas, J. K. (1989). Post-Earnings-Announcement Drift. Journal of Accounting Research, 27.",
  },
  {
    key: "tharp-1999",
    citation:
      "Tharp, V. K. (1999). Trade Your Way to Financial Freedom. McGraw-Hill.",
  },
  {
    key: "elder-2002",
    citation: "Elder, A. (2002). Come Into My Trading Room. Wiley.",
  },
  {
    key: "adr-0076",
    citation:
      "Portal Financiero, ADR 0076: cuenta Schwab de solo lectura y diario de trading.",
  },
];

export const TRADING_GLOSSARY = defineGlossary(
  TRADING_GLOSSARY_VERSION,
  TRADING_SOURCES,
  [
    {
      key: "candlestick",
      term: "Candlestick",
      es: "vela",
      definition:
        "Una vela resume un período en cuatro precios: apertura, máximo, mínimo y cierre. El cuerpo va de la apertura al cierre y las mechas llegan al máximo y al mínimo.",
      formula: null,
      why: "Muestra quién ganó el período y cuánto lo discutió el otro lado.",
      sources: ["nison-1991"],
    },
    {
      key: "wick",
      term: "Wick",
      es: "mecha o sombra",
      definition:
        "La parte de la vela fuera del cuerpo: el precio llegó ahí y fue rechazado antes del cierre.",
      formula: "Mecha superior = máximo − max(apertura, cierre)",
      why: "Una mecha larga es un rechazo: marca dónde aparecieron vendedores o compradores.",
      sources: ["nison-1991"],
    },
    {
      key: "doji",
      term: "Doji",
      es: "vela de indecisión",
      definition:
        "Apertura y cierre casi iguales, con mechas a los dos lados. Ninguno de los dos lados ganó el período.",
      formula: null,
      why: "Después de una tendencia larga avisa que el impulso se frenó; sola no es una señal.",
      sources: ["nison-1991"],
    },
    {
      key: "hammer",
      term: "Hammer",
      es: "martillo",
      definition:
        "Cuerpo chico arriba y mecha inferior de al menos el doble del cuerpo, al final de una baja: vendieron fuerte y los compradores lo recuperaron.",
      formula: null,
      why: "Es un rechazo de precios bajos; necesita la vela siguiente para confirmarse.",
      sources: ["nison-1991"],
    },
    {
      key: "shooting-star",
      term: "Shooting star",
      es: "estrella fugaz",
      definition:
        "El espejo del martillo al final de una suba: cuerpo chico abajo y mecha superior larga.",
      formula: null,
      why: "Marca rechazo de precios altos donde la suba se queda sin compradores.",
      sources: ["nison-1991"],
    },
    {
      key: "engulfing",
      term: "Engulfing",
      es: "envolvente",
      definition:
        "Una vela cuyo cuerpo cubre entero el cuerpo de la anterior, de color opuesto. Alcista al final de una baja, bajista al final de una suba.",
      formula: null,
      why: "El lado que perdía el control lo recuperó en un solo período.",
      sources: ["nison-1991"],
    },
    {
      key: "trend",
      term: "Trend",
      es: "tendencia",
      definition:
        "Alcista mientras cada máximo y cada mínimo quedan sobre los anteriores; bajista al revés. Sin esa secuencia es un rango.",
      formula: null,
      why: "Operar a favor de la tendencia es pedirle al precio que siga haciendo lo que ya hace.",
      sources: ["edwards-magee-1948", "murphy-1999"],
    },
    {
      key: "higher-low",
      term: "Higher high / higher low",
      es: "máximo y mínimo más altos",
      definition:
        "Un máximo sobre el máximo anterior y un mínimo sobre el mínimo anterior: los dos pasos que definen una tendencia alcista.",
      formula: null,
      why: "El primer mínimo que perfora al anterior es la primera señal de que la tendencia se rompió.",
      sources: ["edwards-magee-1948"],
    },
    {
      key: "support",
      term: "Support",
      es: "soporte",
      definition:
        "Un precio donde las bajas se frenaron más de una vez porque aparecieron compradores.",
      formula: null,
      why: "Da un lugar concreto para entrar cerca y poner el stop debajo.",
      sources: ["edwards-magee-1948", "murphy-1999"],
    },
    {
      key: "resistance",
      term: "Resistance",
      es: "resistencia",
      definition:
        "Un precio donde las subas se frenaron más de una vez porque aparecieron vendedores. Superada con volumen, suele pasar a ser soporte.",
      formula: null,
      why: "Es el techo que un breakout necesita romper y el primer target de un rebote.",
      sources: ["edwards-magee-1948", "murphy-1999"],
    },
    {
      key: "breakout",
      term: "Breakout",
      es: "ruptura",
      definition:
        "Un cierre fuera de un rango o de un nivel que contuvo al precio, idealmente con volumen sobre el normal.",
      formula: null,
      why: "Una ruptura sostenida libera la energía acumulada en el rango.",
      sources: ["edwards-magee-1948"],
    },
    {
      key: "false-breakout",
      term: "False breakout",
      es: "ruptura falsa",
      definition:
        "El precio supera el nivel y vuelve adentro del rango enseguida, dejando atrapados a los que compraron la ruptura.",
      formula: null,
      why: "Por eso la ruptura se confirma con un cierre y el stop va del otro lado del nivel.",
      sources: ["murphy-1999"],
    },
    {
      key: "volume",
      term: "Volume",
      es: "volumen",
      definition: "La cantidad de acciones operadas en el período de la vela.",
      formula: null,
      why: "Un movimiento con volumen tiene participación; sin volumen se revierte con facilidad.",
      sources: ["murphy-1999"],
    },
    {
      key: "relative-volume",
      term: "Relative volume",
      es: "volumen relativo",
      definition:
        "El volumen de una vela contra el volumen normal de esa hora o de esos días.",
      formula: "Volumen relativo = volumen ÷ volumen promedio comparable",
      why: "Más de 2× señala que entró algo nuevo: una noticia, un resultado, un nivel.",
      sources: ["murphy-1999"],
    },
    {
      key: "vwap",
      term: "VWAP",
      es: "precio promedio ponderado por volumen",
      definition:
        "El precio promedio de la sesión ponderado por lo que se operó a cada precio. Arranca de cero en cada sesión.",
      formula:
        "VWAP = Σ (precio típico × volumen) ÷ Σ volumen; precio típico = (H + L + C) ÷ 3",
      why: "Es el precio que pagó el comprador promedio del día: arriba manda el comprador, abajo el vendedor.",
      sources: ["berkowitz-1988"],
    },
    {
      key: "sma",
      term: "SMA",
      es: "media móvil simple",
      definition:
        "El promedio de los últimos n cierres, con el mismo peso cada uno.",
      formula: "SMA(n) = (C₁ + … + Cₙ) ÷ n",
      why: "La de 50 y la de 200 días son las que mira todo el mercado como tendencia de fondo.",
      sources: ["murphy-1999"],
    },
    {
      key: "ema",
      term: "EMA",
      es: "media móvil exponencial",
      definition:
        "Una media que pesa más los cierres recientes, así que sigue al precio más rápido que la simple.",
      formula: "EMA = α × C + (1 − α) × EMA previa; α = 2 ÷ (n + 1)",
      why: "La de 9 y la de 20 marcan el ritmo del day trade y del swing corto.",
      sources: ["murphy-1999"],
    },
    {
      key: "rsi",
      term: "RSI",
      es: "índice de fuerza relativa",
      definition:
        "Compara el tamaño de las subas con el de las bajas de los últimos 14 períodos, en una escala de 0 a 100.",
      formula:
        "RSI = 100 − 100 ÷ (1 + suba media ÷ baja media), suavizado de Wilder",
      why: "Mide el impulso: dice si la suba se acelera o se cansa, no si el precio está caro.",
      sources: ["wilder-1978"],
    },
    {
      key: "overbought-oversold",
      term: "Overbought / oversold",
      es: "sobrecompra y sobreventa",
      definition:
        "RSI sobre 70 o bajo 30. En una tendencia fuerte puede quedarse ahí semanas.",
      formula: null,
      why: "Contra la tendencia no es una señal de venta o compra; a favor, un pullback a 40–50 sí sirve.",
      sources: ["wilder-1978"],
    },
    {
      key: "divergence",
      term: "Divergence",
      es: "divergencia",
      definition:
        "El precio hace un máximo nuevo y el RSI o el MACD no lo acompañan (o al revés en un mínimo).",
      formula: null,
      why: "El impulso se agota antes que el precio: avisa, pero no marca el momento.",
      sources: ["wilder-1978", "murphy-1999"],
    },
    {
      key: "macd",
      term: "MACD",
      es: "convergencia y divergencia de medias",
      definition:
        "La diferencia entre la EMA de 12 y la de 26, con su señal (EMA de 9 de esa línea) y el histograma entre las dos.",
      formula:
        "MACD = EMA12 − EMA26; señal = EMA9(MACD); histograma = MACD − señal",
      why: "El cruce de la señal y el cambio del histograma muestran cuándo el impulso cambia de lado.",
      sources: ["appel-1979"],
    },
    {
      key: "opening-range",
      term: "Opening range",
      es: "rango de apertura",
      definition:
        "El máximo y el mínimo de los primeros minutos de la sesión, por lo general 5, 15 o 30.",
      formula: null,
      why: "Es la primera discusión del día: su ruptura suele marcar el lado que gana la mañana.",
      sources: ["crabel-1990"],
    },
    {
      key: "gap",
      term: "Gap",
      es: "hueco",
      definition:
        "Una apertura lejos del cierre anterior, sin operaciones en el medio, por lo general por una noticia fuera de hora.",
      formula: "Gap % = (apertura − cierre anterior) ÷ cierre anterior",
      why: "Un gap con volumen y noticia puede seguir; uno sin noticia suele llenarse.",
      sources: ["murphy-1999"],
    },
    {
      key: "pullback",
      term: "Pullback",
      es: "retroceso",
      definition:
        "Una baja corta dentro de una tendencia alcista que no perfora el último mínimo.",
      formula: null,
      why: "Deja entrar a favor de la tendencia con un stop cercano y conocido.",
      sources: ["murphy-1999"],
    },
    {
      key: "reversal",
      term: "Reversal",
      es: "reversión",
      definition:
        "El cambio de una tendencia a la contraria, confirmado cuando se rompe la secuencia de máximos y mínimos.",
      formula: null,
      why: "Es el setup de mayor recompensa y de menor tasa de acierto: pide el stop más disciplinado.",
      sources: ["edwards-magee-1948", "nison-1991"],
    },
    {
      key: "earnings-drift",
      term: "Post-earnings drift",
      es: "deriva después de resultados",
      definition:
        "Después de una sorpresa en los resultados, el precio tiende a seguir moviéndose en la dirección de la sorpresa durante semanas.",
      formula: null,
      why: "Es la razón de comprar el primer pullback después de un gap de resultados.",
      sources: ["bernard-thomas-1989"],
    },
    {
      key: "stop-loss",
      term: "Stop loss",
      es: "stop",
      definition:
        "El precio en el que el trade está equivocado y se sale. Se decide antes de entrar, del otro lado del nivel que justificó la entrada.",
      formula: null,
      why: "Sin stop no hay riesgo medido, y sin riesgo medido no hay tamaño ni R.",
      sources: ["tharp-1999"],
    },
    {
      key: "r-multiple",
      term: "R multiple",
      es: "resultado en múltiplos del riesgo",
      definition:
        "El resultado de un trade dividido por lo que arriesgaba: ganar el doble de lo arriesgado es +2R; salir en el stop, −1R.",
      formula: "R = P&L ÷ (|entrada − stop| × cantidad)",
      why: "Compara trades de distinto tamaño y precio en la misma unidad.",
      sources: ["tharp-1999", "adr-0076"],
    },
    {
      key: "risk-reward",
      term: "Reward/risk",
      es: "recompensa sobre riesgo",
      definition: "La distancia al target dividida por la distancia al stop.",
      formula: "Reward/risk = |target − entrada| ÷ |entrada − stop|",
      why: "Con 2:1, alcanza acertar un tercio de las veces para no perder.",
      sources: ["tharp-1999"],
    },
    {
      key: "position-sizing",
      term: "Position sizing",
      es: "tamaño de la posición",
      definition:
        "Cuántas acciones comprar para que salir en el stop cueste el porcentaje de la cuenta decidido, nunca más.",
      formula:
        "Acciones = (cuenta × 2 %) ÷ (entrada − stop), redondeado hacia abajo",
      why: "El tamaño, no la entrada, es lo que decide cuánto duele equivocarse.",
      sources: ["elder-2002", "adr-0076"],
    },
    {
      key: "open-risk",
      term: "Open risk",
      es: "riesgo abierto",
      definition:
        "Lo que se perdería si todas las posiciones abiertas salieran en su stop a la vez.",
      formula:
        "Riesgo abierto = Σ (precio − stop) × cantidad, tope 6 % de la cuenta",
      why: "Varias posiciones al 2 % pueden caer juntas: el 6 % es el techo de toda la cartera.",
      sources: ["elder-2002", "adr-0076"],
    },
    {
      key: "expectancy",
      term: "Expectancy",
      es: "esperanza por trade",
      definition: "Lo que gana o pierde en promedio cada trade de un setup.",
      formula:
        "Expectancy = win rate × ganancia media − (1 − win rate) × pérdida media",
      why: "Un setup con expectancy negativa pierde aunque acierte seguido.",
      sources: ["tharp-1999", "adr-0076"],
    },
    {
      key: "win-rate",
      term: "Win rate",
      es: "tasa de acierto",
      definition:
        "Los trades ganadores sobre todos los cerrados, con los empates en el denominador.",
      formula: "Win rate = ganadores ÷ trades cerrados",
      why: "Sola no dice nada: hay que leerla con el tamaño de la ganancia y la pérdida media.",
      sources: ["tharp-1999", "adr-0076"],
    },
  ],
);
