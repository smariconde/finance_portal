import { SectionNav } from "@/app/_components/section-nav";

/** Las dos matrices de un sector son rutas hermanas: cada una lee sólo lo suyo. */
export function SectorMatrixNav({
  sectorCode,
  current,
}: {
  readonly sectorCode: string;
  readonly current: "risk" | "divergences";
}) {
  return (
    <SectionNav
      label="Matrices del sector"
      current={current}
      items={[
        { key: "risk", label: "Riesgo", href: `/sectores/${sectorCode}` },
        {
          key: "divergences",
          label: "Divergencias",
          href: `/sectores/${sectorCode}/divergencias`,
        },
      ]}
    />
  );
}
