import { z } from "zod";

import { earningsReportSchema, type EarningsReport } from "./earnings-calendar";

export const economicPublicationSchema = z.strictObject({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(180),
  date: z.iso.date(),
  period: z.iso.date().nullable(),
  status: z.enum(["scheduled", "cancelled"]).default("scheduled"),
});
export type EconomicPublication = z.infer<typeof economicPublicationSchema>;

export const calendarEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("earnings"), report: earningsReportSchema }),
  z.strictObject({
    kind: z.literal("economic"),
    publication: economicPublicationSchema,
  }),
]);
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export type CalendarRevision = {
  readonly key: string;
  readonly event: CalendarEvent;
  readonly previous: CalendarEvent | null;
  readonly observedAt: string;
};

export type EarningsCalendarView = {
  readonly observedAt: string | null;
  readonly reports: readonly (EarningsReport & {
    readonly previousDate: string | null;
  })[];
};

export function dateOf(event: CalendarEvent): string {
  return event.kind === "earnings" ? event.report.date : event.publication.date;
}
