import { Fold } from "@/app/_components/fold";

import { INLINE_TICKERS, type MissingGroup } from "./missing-groups";

type Missing = { readonly id: string; readonly label: string };

/**
 * Lo que la matriz no dibuja, un renglón por motivo: el motivo, cuántos son y
 * sus tickers. Un grupo largo pliega los tickers, para que un sector sin
 * fundamentales no empuje la tabla sesenta renglones hacia abajo.
 */
export function MissingByReason({
  groups,
  empty,
}: {
  readonly groups: readonly MissingGroup<Missing>[];
  /** Lo que se dice cuando no falta nada. */
  readonly empty: string;
}) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="flex flex-col divide-y text-sm">
      {groups.map((group) => {
        const tickers = (
          <p className="text-xs leading-5 text-muted-foreground">
            {group.items.map((item) => item.label).join(" · ")}
          </p>
        );

        return (
          <li
            key={group.reason}
            className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0"
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{group.reason}</span>
              <span className="numeric text-muted-foreground">
                {group.items.length}
              </span>
            </span>
            {group.items.length <= INLINE_TICKERS ? (
              tickers
            ) : (
              <Fold
                divided={false}
                summary={`Ver los ${group.items.length}`}
                contentClassName="pt-1"
              >
                {tickers}
              </Fold>
            )}
          </li>
        );
      })}
    </ul>
  );
}
