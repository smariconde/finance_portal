import { Ban, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConfigStatus } from "@/modules/configuration/domain/config-health";

export type AvailabilityStatus = ConfigStatus | "planned";

const statusConfig = {
  ready: {
    label: "Listo",
    icon: CheckCircle2,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  degraded: {
    label: "Requiere atención",
    icon: TriangleAlert,
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  },
  disabled: {
    label: "Deshabilitado",
    icon: Ban,
    className:
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300",
  },
  planned: {
    label: "Planificado",
    icon: CircleDashed,
    className:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  },
} as const;

type StatusMarkProps = {
  status: AvailabilityStatus;
  label?: string;
};

export function StatusMark({ status, label }: StatusMarkProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1", config.className)}
      aria-label={`Estado: ${label ?? config.label}`}
    >
      <Icon aria-hidden="true" />
      {label ?? config.label}
    </Badge>
  );
}
