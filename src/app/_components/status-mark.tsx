import type { ConfigStatus } from "@/modules/configuration/domain/config-health";

export type AvailabilityStatus = ConfigStatus | "planned";

const statusLabels: Record<AvailabilityStatus, string> = {
  ready: "Listo",
  degraded: "Requiere atención",
  disabled: "Deshabilitado",
  planned: "Planificado",
};

type StatusMarkProps = {
  status: AvailabilityStatus;
  label?: string;
};

export function StatusMark({ status, label }: StatusMarkProps) {
  return (
    <span className={`status-mark status-${status}`}>
      <span aria-hidden="true" />
      {label ?? statusLabels[status]}
    </span>
  );
}
