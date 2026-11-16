import { SectionNav } from "@/app/_components/section-nav";

/** El plan y el armador de Finviz son rutas hermanas (`F11-13`). */
export function PlanNav({ current }: { readonly current: "ideas" | "finviz" }) {
  return (
    <SectionNav
      label="Secciones del plan"
      current={current}
      items={[
        { key: "ideas", label: "Ideas", href: "/plan" },
        { key: "finviz", label: "Finviz", href: "/plan/finviz" },
      ]}
    />
  );
}
