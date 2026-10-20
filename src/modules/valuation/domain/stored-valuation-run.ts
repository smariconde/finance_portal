import { z } from "zod";

import { excessReturnRunSchema } from "./excess-return-run";
import { valuationRunSchema } from "./valuation-run";

/** Persistence accepts each implemented method with its own closed contract. */
export const storedValuationRunSchema = z.union([
  valuationRunSchema,
  excessReturnRunSchema,
]);
export type StoredValuationRun = z.infer<typeof storedValuationRunSchema>;
