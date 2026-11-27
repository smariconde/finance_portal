import { Ban, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConfigStatus } from "@/modules/configuration/domain/config-health";

export type AvailabilityStatus = ConfigStatus | "planned";

const statusConfig = {
  ready: {
    label: "Listo",
    icon: CheckCircle2,
    className: "border-positive-border bg-positive-surface text-positive",
  },
  degraded: {
    label: "Requiere atención",
    icon: TriangleAlert,
    className: "border-warning-border bg-warning-surface text-warning",
  },
  disabled: {
    label: "Deshabilitado",
    icon: Ban,
    className: "border-border bg-muted text-muted-foreground",
  },
  planned: {
    label: "Planificado",
    icon: CircleDashed,
    className: "border-info-border bg-info-surface text-info",
  },
} as const;

type StatusMarkProps = {
  status: AvailabilityStatus;
  /** Un nodo, para que un ancho angosto pueda ocultar parte del rótulo. */
  label?: ReactNode;
};

export function StatusMark({ status, label }: StatusMarkProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn("gap-1", config.className)}>
      <Icon aria-hidden="true" />
      <span className="sr-only">Estado: </span>
      {label ?? config.label}
    </Badge>
  );
}
