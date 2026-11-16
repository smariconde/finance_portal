import type { RoundTrip } from "@/modules/trading/domain/trade-round-trips";
import type { IdeaFields } from "@/modules/trading/domain/pre-market-plan";

export type StoredIdea = IdeaFields & {
  readonly ideaId: string;
  readonly revisionId: string;
  readonly accountKey: string;
  readonly revision: number;
  readonly version: string;
  readonly formulaVersion: string;
  readonly liquidationValue: string;
  readonly riskPercent: string;
  readonly recordedAt: string;
};

export type IdeaLink = {
  readonly ideaId: string;
  readonly tradeKey: string;
  readonly planRevisionId: string;
  readonly openedAt: string;
  readonly linkedAt: string;
};

export type SaveIdeaInput = {
  readonly accountKey: string;
  readonly ideaId: string;
  readonly baseRevision: number | null;
  readonly fields: IdeaFields;
  readonly liquidationValue: string;
  readonly riskPercent: string;
  readonly recordedAt: string;
};

export type SaveIdeaResult =
  | { readonly state: "saved" | "unchanged"; readonly idea: StoredIdea }
  | { readonly state: "conflict" };

export interface PreMarketStore {
  listCurrent(accountKey: string): Promise<StoredIdea[]>;
  listRevisions(accountKey: string, ideaId: string): Promise<StoredIdea[]>;
  listLinks(
    accountKey: string,
  ): Promise<
    ReadonlyMap<string, { readonly link: IdeaLink; readonly idea: StoredIdea }>
  >;
  readLink(
    accountKey: string,
    tradeKey: string,
  ): Promise<{ readonly link: IdeaLink; readonly idea: StoredIdea } | null>;
  save(input: SaveIdeaInput): Promise<SaveIdeaResult>;
  /** Sólo une una idea inequívoca de la misma sesión de Nueva York, fechada
   * antes de la primera ejecución; las demás quedan para decisión del owner. */
  reconcile(
    accountKey: string,
    trades: readonly RoundTrip[],
    now: string,
  ): Promise<number>;
  link(
    accountKey: string,
    ideaId: string,
    trade: RoundTrip,
    now: string,
  ): Promise<"linked" | "ineligible" | "conflict">;
}
