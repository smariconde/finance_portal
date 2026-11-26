import type { ReactNode } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import {
  ARGENTINA_BLOCK_GUIDES,
  argentinaBlockLabel,
  isArgentinaBlockId,
} from "@/modules/argentina-dashboard/domain/block-guides";

function Part({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Lines({ lines }: { readonly lines: readonly string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-muted-foreground/60">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * El ⓘ junto al título de un bloque (`argentina-block-guides-1.0.0`,
 * `F9-23`): para qué sirve, cómo leerlo, con qué cruzarlo —cada bloque, un
 * vínculo a su sección— y qué puede confundir. La guía está en el código, no
 * en la página: el cuerpo del bloque sigue siendo la cifra y el gráfico.
 */
export function BlockGuide({
  blockId,
  title,
}: {
  readonly blockId: string;
  readonly title: string;
}) {
  if (!isArgentinaBlockId(blockId)) return null;
  const guide = ARGENTINA_BLOCK_GUIDES[blockId];
  return (
    <InfoTip title={title} wide>
      <p className="text-foreground">{guide.purpose}</p>
      <Part title="Cómo leerlo">
        <Lines lines={guide.read} />
      </Part>
      <Part title="Cruzalo con">
        <ul className="flex flex-col gap-1">
          {guide.crossWith.map((cross) => (
            <li key={cross.blockId}>
              <a
                href={`#${cross.blockId}`}
                className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {argentinaBlockLabel(cross.blockId)}
              </a>
              : {cross.text}
            </li>
          ))}
        </ul>
      </Part>
      <Part title="Ojo con">
        <Lines lines={guide.caveats} />
      </Part>
    </InfoTip>
  );
}
