import { SectionNav } from "@/app/_components/section-nav";

/** El diario y sus estadísticas son rutas hermanas (`F11-08`). */
export function JournalNav({
  current,
}: {
  readonly current: "journal" | "stats";
}) {
  return (
    <SectionNav
      label="Secciones del diario"
      current={current}
      items={[
        { key: "journal", label: "Trades", href: "/diario" },
        { key: "stats", label: "Estadísticas", href: "/diario/estadisticas" },
      ]}
    />
  );
}
