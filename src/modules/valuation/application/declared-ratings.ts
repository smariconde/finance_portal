import {
  ratingDeclarationSchema,
  type RatingDeclaration,
} from "../domain/declared-rating";

/**
 * Ratings declarados por el owner, por CIK (`F6-42`, `declared-rating-1.0.0`).
 *
 * Sólo cuando el sintético no mide la empresa y hay calificaciones publicadas:
 * la declarada es la menor de ellas, con la etiqueta de la tabla de la corrida.
 * Agregar una es un diff revisable; la corrida dice que el rating es declarado.
 */
export const DECLARED_RATINGS: readonly RatingDeclaration[] = Object.freeze(
  (
    [
      {
        // Ford: −7,3 de cobertura en 2025 por los cargos de vehículos
        // eléctricos; el promedio 2020–2025 también da CCC (1,05).
        cik: "0000037996",
        ticker: "F",
        rating: "Ba1/BB+",
        decidedBy: "owner",
        declaredAt: "2026-11-19T13:30:00.000Z",
        rationale:
          "Decisión delegada por el owner el 2026-11-19. El sintético da D2/D por un solo ejercicio con cargos especiales, y la normalización no los revierte porque Ford tiene cargos todos los años. Se declara la menor de las tres calificaciones publicadas (Moody's Ba1; S&P y Fitch BBB-): la fila Ba1/BB+ de la tabla.",
        publishedRatings: [
          {
            agency: "Moody's",
            rating: "Ba1",
            source:
              "https://www.moodys.com/credit-ratings/Ford-Motor-Company-credit-rating-298500",
          },
          {
            agency: "S&P",
            rating: "BBB-",
            source:
              "https://www.investing.com/news/stock-market-news/sp-lifts-ford-outlook-to-stable-on-cost-cuts-and-cash-flow-recovery-4996100",
          },
          {
            agency: "Fitch",
            rating: "BBB-",
            source:
              "https://www.ford.com/finance/content/dam/ucl/brandsites/pdf/Ford_Motor_Credit_FIA_Prospectus.pdf",
          },
        ],
      },
    ] as const satisfies readonly unknown[]
  ).map((entry) => ratingDeclarationSchema.parse(entry)),
);
