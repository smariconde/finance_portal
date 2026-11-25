/**
 * Lector cerrado del instance XBRL de un 10-K (`F6-23`,
 * [ADR 0082](../../../../docs/architecture/adr/0082-captive-finance-split.md)).
 *
 * companyfacts no trae dimensiones, y la apertura de una financiera cautiva
 * —la deuda de CAT por un lado y la de Cat Financial por el otro— sólo existe
 * como hechos con un miembro explícito. El instance es el `_htm.xml` que EDGAR
 * extrae del iXBRL, en la carpeta de la presentación.
 *
 * No es un parser de XBRL: lee lo que la apertura necesita y rechaza el resto.
 *
 * - Un `DOCTYPE` rechaza el documento entero: sin entidades externas.
 * - La raíz tiene que declarar el namespace del instance; los prefijos se
 *   resuelven por namespace, nunca por nombre (`us-gaap` es cualquier prefijo
 *   de `http://fasb.org/us-gaap/`).
 * - Un contexto se lee con su CIK, su período y sus miembros explícitos por
 *   nombre local; uno con un miembro tipado queda marcado y no se usa.
 * - Un hecho es numérico, `us-gaap`, con contexto y unidad; un nulo o un texto
 *   no es un hecho. El valor es el texto publicado, nunca un `number`.
 * - El mismo concepto con dos valores distintos en el mismo contexto y unidad
 *   se descarta y se nombra: no hay forma de elegir uno.
 */
export const SEC_XBRL_INSTANCE_VERSION = "sec-xbrl-instance-1.0.0";

const INSTANCE_NAMESPACE = "http://www.xbrl.org/2003/instance";
const DIMENSION_NAMESPACE = "http://xbrl.org/2006/xbrldi";
const ISO4217_NAMESPACE = "http://www.xbrl.org/2003/iso4217";
const US_GAAP_NAMESPACE_PREFIX = "http://fasb.org/us-gaap/";

const CIK_SCHEME = "http://www.sec.gov/CIK";
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const DECIMAL = /^-?[0-9]{1,24}(?:\.[0-9]{1,12})?$/u;
const NAME = "[A-Za-z_][A-Za-z0-9_.-]*";

export type XbrlMember = {
  /** Nombre local del eje, sin prefijo. */
  readonly axis: string;
  /** Nombre local del miembro, sin prefijo. */
  readonly member: string;
};

export type XbrlContext = {
  readonly id: string;
  readonly cik: string;
  readonly instant: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly members: readonly XbrlMember[];
  readonly typed: boolean;
};

export type XbrlNumericFact = {
  /** `us-gaap:<local>`, con el prefijo canónico. */
  readonly concept: string;
  readonly contextId: string;
  /** La unidad es USD: un hecho en otra unidad no se lee. */
  readonly value: string;
};

export type XbrlInstance = {
  readonly version: typeof SEC_XBRL_INSTANCE_VERSION;
  readonly contexts: ReadonlyMap<string, XbrlContext>;
  readonly facts: readonly XbrlNumericFact[];
  /** Conceptos con dos valores en un mismo contexto: descartados. */
  readonly conflicting: readonly string[];
};

export type XbrlInstanceRejection =
  "doctype_present" | "instance_root_missing" | "no_contexts";

export type ReadXbrlInstanceResult =
  | { readonly status: "read"; readonly instance: XbrlInstance }
  | { readonly status: "rejected"; readonly reason: XbrlInstanceRejection };

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** `prefijo:` para un namespace, o vacío si es el namespace por defecto. */
function qualified(prefix: string): string {
  return prefix === "" ? "" : `${escape(prefix)}:`;
}

function namespacesOf(rootTag: string): Map<string, string> {
  const namespaces = new Map<string, string>();
  for (const match of rootTag.matchAll(
    /\sxmlns(?::([A-Za-z_][A-Za-z0-9_.-]*))?="([^"]*)"/gu,
  )) {
    namespaces.set(match[1] ?? "", match[2]!);
  }
  return namespaces;
}

function prefixesFor(
  namespaces: ReadonlyMap<string, string>,
  matches: (namespace: string) => boolean,
): string[] {
  return [...namespaces]
    .filter(([, namespace]) => matches(namespace))
    .map(([prefix]) => prefix);
}

function localName(qname: string): string {
  const colon = qname.lastIndexOf(":");
  return colon === -1 ? qname : qname.slice(colon + 1);
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${escape(name)}="([^"]*)"`, "u").exec(tag);
  return match === null ? null : match[1]!;
}

function readContexts(
  xml: string,
  instance: string,
  dimension: readonly string[],
): Map<string, XbrlContext> {
  const contexts = new Map<string, XbrlContext>();
  const pattern = new RegExp(
    `<${instance}context\\b([^>]*)>([\\s\\S]*?)</${instance}context>`,
    "gu",
  );
  const explicit = dimension.map(
    (prefix) =>
      new RegExp(
        `<${qualified(prefix)}explicitMember\\b([^>]*)>\\s*(${NAME}(?::${NAME})?)\\s*</${qualified(prefix)}explicitMember>`,
        "gu",
      ),
  );
  const typed = dimension.map(
    (prefix) => new RegExp(`<${qualified(prefix)}typedMember\\b`, "u"),
  );
  const field = (body: string, name: string): string | null => {
    const match = new RegExp(
      `<${instance}${name}>\\s*([^<\\s]+)\\s*</${instance}${name}>`,
      "u",
    ).exec(body);
    return match === null ? null : match[1]!;
  };

  for (const match of xml.matchAll(pattern)) {
    const id = attribute(match[1]!, "id");
    const body = match[2]!;
    const identifier = new RegExp(
      `<${instance}identifier\\b([^>]*)>\\s*([0-9]{10})\\s*</${instance}identifier>`,
      "u",
    ).exec(body);

    if (
      id === null ||
      identifier === null ||
      attribute(identifier[1]!, "scheme") !== CIK_SCHEME
    ) {
      continue;
    }

    const instant = field(body, "instant");
    const startDate = field(body, "startDate");
    const endDate = field(body, "endDate");
    const dates = [instant, startDate, endDate].filter(
      (value): value is string => value !== null,
    );

    if (dates.some((value) => !DATE.test(value))) {
      continue;
    }

    const members = explicit.flatMap((regex) =>
      [...body.matchAll(regex)].flatMap((member) => {
        const axis = attribute(member[1]!, "dimension");
        return axis === null
          ? []
          : [{ axis: localName(axis), member: localName(member[2]!) }];
      }),
    );

    contexts.set(id, {
      id,
      cik: identifier[2]!,
      instant,
      startDate,
      endDate,
      members,
      typed: typed.some((regex) => regex.test(body)),
    });
  }

  return contexts;
}

function usdUnits(
  xml: string,
  instance: string,
  iso4217: readonly string[],
): Set<string> {
  const units = new Set<string>();
  const pattern = new RegExp(
    `<${instance}unit\\b([^>]*)>\\s*<${instance}measure>\\s*(${NAME}):USD\\s*</${instance}measure>\\s*</${instance}unit>`,
    "gu",
  );
  for (const match of xml.matchAll(pattern)) {
    const id = attribute(match[1]!, "id");
    if (id !== null && iso4217.includes(match[2]!)) {
      units.add(id);
    }
  }
  return units;
}

/** Lee el instance. Puro: no abre red ni resuelve el schema. */
export function readXbrlInstance(xml: string): ReadXbrlInstanceResult {
  if (/<!DOCTYPE/iu.test(xml)) {
    return { status: "rejected", reason: "doctype_present" };
  }

  const root = /<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?)xbrl\b[^>]*>/u.exec(xml);

  if (root === null) {
    return { status: "rejected", reason: "instance_root_missing" };
  }

  const namespaces = namespacesOf(root[0]);
  const rootPrefix = root[1]!.replace(/:$/u, "");

  if (namespaces.get(rootPrefix) !== INSTANCE_NAMESPACE) {
    return { status: "rejected", reason: "instance_root_missing" };
  }

  const instance = qualified(rootPrefix);
  const contexts = readContexts(
    xml,
    instance,
    prefixesFor(namespaces, (namespace) => namespace === DIMENSION_NAMESPACE),
  );

  if (contexts.size === 0) {
    return { status: "rejected", reason: "no_contexts" };
  }

  const units = usdUnits(
    xml,
    instance,
    prefixesFor(namespaces, (namespace) => namespace === ISO4217_NAMESPACE),
  );
  const values = new Map<string, XbrlNumericFact>();
  const conflicting = new Set<string>();

  for (const prefix of prefixesFor(namespaces, (namespace) =>
    namespace.startsWith(US_GAAP_NAMESPACE_PREFIX),
  )) {
    const pattern = new RegExp(
      `<${qualified(prefix)}(${NAME})\\b([^>]*?)>([^<]*)</${qualified(prefix)}\\1>`,
      "gu",
    );

    for (const match of xml.matchAll(pattern)) {
      const attributes = match[2]!;
      const contextId = attribute(attributes, "contextRef");
      const unitId = attribute(attributes, "unitRef");
      const value = match[3]!.trim();

      if (
        contextId === null ||
        unitId === null ||
        !units.has(unitId) ||
        !contexts.has(contextId) ||
        !DECIMAL.test(value)
      ) {
        continue;
      }

      const concept = `us-gaap:${match[1]!}`;
      const key = `${concept}\u0000${contextId}`;
      const previous = values.get(key);

      if (previous === undefined) {
        values.set(key, { concept, contextId, value });
      } else if (previous.value !== value) {
        conflicting.add(concept);
      }
    }
  }

  return {
    status: "read",
    instance: {
      version: SEC_XBRL_INSTANCE_VERSION,
      contexts,
      facts: [...values.values()].filter(
        (fact) => !conflicting.has(fact.concept),
      ),
      conflicting: [...conflicting].sort(),
    },
  };
}

export type SegmentPeriod =
  | { readonly kind: "instant"; readonly date: string }
  | {
      readonly kind: "duration";
      readonly endDate: string;
      readonly minDays: number;
      readonly maxDays: number;
    };

const DAY_MS = 86_400_000;

function matchesPeriod(context: XbrlContext, period: SegmentPeriod): boolean {
  if (period.kind === "instant") {
    return context.instant === period.date;
  }
  if (context.startDate === null || context.endDate !== period.endDate) {
    return false;
  }
  const days =
    (Date.parse(`${context.endDate}T00:00:00Z`) -
      Date.parse(`${context.startDate}T00:00:00Z`)) /
      DAY_MS +
    1;
  return days >= period.minDays && days <= period.maxDays;
}

/**
 * Los hechos de un miembro en un período: contextos del CIK con ese único
 * miembro explícito en ese eje y ningún otro, ni tipado. Un concepto que dos
 * contextos así publican con valores distintos no se devuelve.
 */
export function segmentFacts(
  instance: XbrlInstance,
  selection: {
    readonly cik: string;
    readonly member: XbrlMember;
    readonly period: SegmentPeriod;
  },
): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const fact of instance.facts) {
    const context = instance.contexts.get(fact.contextId)!;
    const [only, ...rest] = context.members;

    if (
      context.cik !== selection.cik ||
      context.typed ||
      only === undefined ||
      rest.length > 0 ||
      only.axis !== selection.member.axis ||
      only.member !== selection.member.member ||
      !matchesPeriod(context, selection.period)
    ) {
      continue;
    }

    const previous = found.get(fact.concept);
    if (previous === undefined) {
      found.set(fact.concept, fact.value);
    } else if (previous !== fact.value) {
      ambiguous.add(fact.concept);
    }
  }

  for (const concept of ambiguous) {
    found.delete(concept);
  }

  return found;
}

/**
 * La carátula por clase de acciones (`sec-xbrl-cover-shares-1.0.0`, `F6-32`).
 *
 * Un filer con varias clases publica `dei:EntityCommonStockSharesOutstanding`
 * sólo con un miembro de `StatementClassOfStockAxis`, y `companyfacts` no trae
 * dimensiones: sin el instance, PLTR, DDOG, RDDT, GOOGL, META, F y BRK no
 * tienen conteo. Las mismas defensas que el lector de la apertura: sin
 * `DOCTYPE`, prefijos por namespace, contextos del CIK. La unidad tiene que
 * medir `shares` del namespace del instance, y un mismo contexto con dos
 * valores distintos se descarta.
 */
export const SEC_XBRL_COVER_SHARES_VERSION = "sec-xbrl-cover-shares-1.0.0";

const DEI_NAMESPACE_PREFIX = "http://xbrl.sec.gov/dei/";
const COVER_SHARES_LOCAL = "EntityCommonStockSharesOutstanding";
const SHARES_COUNT = /^[0-9]{1,15}$/u;

export type CoverShareFact = {
  readonly contextId: string;
  readonly cik: string;
  readonly instant: string | null;
  readonly members: readonly XbrlMember[];
  readonly typed: boolean;
  /** Entero publicado, como texto. */
  readonly value: string;
};

export type ReadCoverSharesResult =
  | {
      readonly status: "read";
      readonly version: typeof SEC_XBRL_COVER_SHARES_VERSION;
      readonly facts: readonly CoverShareFact[];
      /** Contextos con dos valores distintos: descartados. */
      readonly conflicting: readonly string[];
    }
  | { readonly status: "rejected"; readonly reason: XbrlInstanceRejection };

function shareUnits(xml: string, instance: string): Set<string> {
  const units = new Set<string>();
  const namespaces = /<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?)xbrl\b[^>]*>/u.exec(xml);
  const instancePrefixes =
    namespaces === null
      ? []
      : prefixesFor(
          namespacesOf(namespaces[0]),
          (namespace) => namespace === INSTANCE_NAMESPACE,
        );
  const pattern = new RegExp(
    `<${instance}unit\\b([^>]*)>\\s*<${instance}measure>\\s*((?:${NAME}:)?)shares\\s*</${instance}measure>\\s*</${instance}unit>`,
    "gu",
  );
  for (const match of xml.matchAll(pattern)) {
    const id = attribute(match[1]!, "id");
    const prefix = match[2]!.replace(/:$/u, "");
    if (id !== null && instancePrefixes.includes(prefix)) {
      units.add(id);
    }
  }
  return units;
}

/** Lee los conteos de la carátula. Puro: no abre red. */
export function readCoverShares(xml: string): ReadCoverSharesResult {
  if (/<!DOCTYPE/iu.test(xml)) {
    return { status: "rejected", reason: "doctype_present" };
  }

  const root = /<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?)xbrl\b[^>]*>/u.exec(xml);

  if (root === null) {
    return { status: "rejected", reason: "instance_root_missing" };
  }

  const namespaces = namespacesOf(root[0]);
  const rootPrefix = root[1]!.replace(/:$/u, "");

  if (namespaces.get(rootPrefix) !== INSTANCE_NAMESPACE) {
    return { status: "rejected", reason: "instance_root_missing" };
  }

  const instance = qualified(rootPrefix);
  const contexts = readContexts(
    xml,
    instance,
    prefixesFor(namespaces, (namespace) => namespace === DIMENSION_NAMESPACE),
  );

  if (contexts.size === 0) {
    return { status: "rejected", reason: "no_contexts" };
  }

  const units = shareUnits(xml, instance);
  const values = new Map<string, CoverShareFact>();
  const conflicting = new Set<string>();

  for (const prefix of prefixesFor(namespaces, (namespace) =>
    namespace.startsWith(DEI_NAMESPACE_PREFIX),
  )) {
    const pattern = new RegExp(
      `<${qualified(prefix)}${COVER_SHARES_LOCAL}\\b([^>]*?)>([^<]*)</${qualified(prefix)}${COVER_SHARES_LOCAL}>`,
      "gu",
    );

    for (const match of xml.matchAll(pattern)) {
      const contextId = attribute(match[1]!, "contextRef");
      const unitId = attribute(match[1]!, "unitRef");
      const value = match[2]!.trim();
      const context = contextId === null ? undefined : contexts.get(contextId);

      if (
        context === undefined ||
        unitId === null ||
        !units.has(unitId) ||
        !SHARES_COUNT.test(value)
      ) {
        continue;
      }

      const previous = values.get(context.id);
      if (previous === undefined) {
        values.set(context.id, {
          contextId: context.id,
          cik: context.cik,
          instant: context.instant,
          members: context.members,
          typed: context.typed,
          value,
        });
      } else if (previous.value !== value) {
        conflicting.add(context.id);
      }
    }
  }

  return {
    status: "read",
    version: SEC_XBRL_COVER_SHARES_VERSION,
    facts: [...values.values()].filter(
      (fact) => !conflicting.has(fact.contextId),
    ),
    conflicting: [...conflicting].sort(),
  };
}

/**
 * Hechos de acciones con su unidad (`sec-xbrl-share-facts-1.0.0`, `F6-49`).
 *
 * Un filer con varias clases publica acciones diluidas y EPS sólo por clase
 * (Visa desde 2009), y las tasas de conversión entre clases en conceptos de su
 * propia extensión (`v:CommonStockConversionRate`). `readXbrlInstance` sólo lee
 * `us-gaap` en USD; éste lee los conceptos pedidos en cuatro unidades:
 *
 * - `usd`: una medida `USD` del namespace ISO 4217.
 * - `shares` y `pure`: una medida del namespace del instance (con o sin
 *   prefijo, porque Visa declara ese namespace por defecto).
 * - `usd_per_share`: un `divide` de `USD` sobre `shares`.
 *
 * Otra unidad no se lee. Un concepto de extensión es uno de un namespace que no
 * es de un emisor de taxonomías estándar (XBRL International, FASB, la SEC o el
 * W3C): el filer lo nombra en su propio namespace y el pedido sólo da el nombre
 * local. Cada hecho conserva `decimals` —el redondeo impreso—, `null` cuando es
 * `INF`; un hecho sin `decimals` no se lee. Las mismas defensas que los otros
 * lectores: sin `DOCTYPE`, prefijos por namespace, contextos del CIK, y un
 * concepto con dos valores en el mismo contexto se descarta y se nombra.
 */
export const SEC_XBRL_SHARE_FACTS_VERSION = "sec-xbrl-share-facts-1.0.0";

export type XbrlUnitKind = "usd" | "shares" | "pure" | "usd_per_share";

export type XbrlShareFact = {
  /** `us-gaap:<local>` o `extension:<local>`. */
  readonly concept: string;
  readonly contextId: string;
  readonly unit: XbrlUnitKind;
  /** El texto publicado, nunca un `number`. */
  readonly value: string;
  /** Potencia de diez del redondeo impreso; `null` si es exacto (`INF`). */
  readonly decimals: number | null;
};

export type XbrlShareFacts = {
  readonly version: typeof SEC_XBRL_SHARE_FACTS_VERSION;
  readonly contexts: ReadonlyMap<string, XbrlContext>;
  readonly facts: readonly XbrlShareFact[];
  /** Conceptos con dos valores distintos en un mismo contexto: descartados. */
  readonly conflicting: readonly string[];
};

export type ReadXbrlShareFactsResult =
  | { readonly status: "read"; readonly read: XbrlShareFacts }
  | { readonly status: "rejected"; readonly reason: XbrlInstanceRejection };

export type XbrlShareFactSelection = {
  /** Nombres locales de `us-gaap`. */
  readonly usGaap: readonly string[];
  /** Nombres locales en la extensión del filer. */
  readonly extension: readonly string[];
};

const STANDARD_NAMESPACE_PREFIXES = [
  "http://www.xbrl.org/",
  "http://xbrl.org/",
  "http://fasb.org/",
  "http://xbrl.sec.gov/",
  "http://www.w3.org/",
] as const;

const DECIMALS = /^-?[0-9]{1,2}$/u;

function unitKinds(
  xml: string,
  instance: string,
  namespaces: ReadonlyMap<string, string>,
): Map<string, XbrlUnitKind> {
  const units = new Map<string, XbrlUnitKind>();
  const instancePrefixes = prefixesFor(
    namespaces,
    (namespace) => namespace === INSTANCE_NAMESPACE,
  );
  const isoPrefixes = prefixesFor(
    namespaces,
    (namespace) => namespace === ISO4217_NAMESPACE,
  );
  const measure = (body: string): string | null => {
    const match = new RegExp(
      `^\\s*<${instance}measure>\\s*((?:${NAME}:)?${NAME})\\s*</${instance}measure>\\s*$`,
      "u",
    ).exec(body);
    return match === null ? null : match[1]!;
  };
  const kindOf = (qname: string): "usd" | "shares" | "pure" | null => {
    const colon = qname.indexOf(":");
    const prefix = colon === -1 ? "" : qname.slice(0, colon);
    const local = colon === -1 ? qname : qname.slice(colon + 1);
    if (local === "USD" && isoPrefixes.includes(prefix)) return "usd";
    if (local === "shares" && instancePrefixes.includes(prefix)) {
      return "shares";
    }
    if (local === "pure" && instancePrefixes.includes(prefix)) return "pure";
    return null;
  };
  const pattern = new RegExp(
    `<${instance}unit\\b([^>]*)>([\\s\\S]*?)</${instance}unit>`,
    "gu",
  );
  const divide = new RegExp(
    `^\\s*<${instance}divide>\\s*<${instance}unitNumerator>([\\s\\S]*?)</${instance}unitNumerator>\\s*<${instance}unitDenominator>([\\s\\S]*?)</${instance}unitDenominator>\\s*</${instance}divide>\\s*$`,
    "u",
  );

  for (const match of xml.matchAll(pattern)) {
    const id = attribute(match[1]!, "id");
    if (id === null) continue;
    const body = match[2]!;
    const single = measure(body);
    if (single !== null) {
      const kind = kindOf(single);
      if (kind !== null) units.set(id, kind);
      continue;
    }
    const parts = divide.exec(body);
    if (parts === null) continue;
    const numerator = measure(parts[1]!);
    const denominator = measure(parts[2]!);
    if (
      numerator !== null &&
      denominator !== null &&
      kindOf(numerator) === "usd" &&
      kindOf(denominator) === "shares"
    ) {
      units.set(id, "usd_per_share");
    }
  }

  return units;
}

/** Lee los hechos de acciones pedidos. Puro: no abre red. */
export function readXbrlShareFacts(
  xml: string,
  selection: XbrlShareFactSelection,
): ReadXbrlShareFactsResult {
  if (/<!DOCTYPE/iu.test(xml)) {
    return { status: "rejected", reason: "doctype_present" };
  }

  const root = /<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?)xbrl\b[^>]*>/u.exec(xml);

  if (root === null) {
    return { status: "rejected", reason: "instance_root_missing" };
  }

  const namespaces = namespacesOf(root[0]);
  const rootPrefix = root[1]!.replace(/:$/u, "");

  if (namespaces.get(rootPrefix) !== INSTANCE_NAMESPACE) {
    return { status: "rejected", reason: "instance_root_missing" };
  }

  const instance = qualified(rootPrefix);
  const contexts = readContexts(
    xml,
    instance,
    prefixesFor(namespaces, (namespace) => namespace === DIMENSION_NAMESPACE),
  );

  if (contexts.size === 0) {
    return { status: "rejected", reason: "no_contexts" };
  }

  const units = unitKinds(xml, instance, namespaces);
  const groups: {
    readonly label: string;
    readonly prefixes: string[];
    readonly locals: readonly string[];
  }[] = [
    {
      label: "us-gaap",
      prefixes: prefixesFor(namespaces, (namespace) =>
        namespace.startsWith(US_GAAP_NAMESPACE_PREFIX),
      ).filter((prefix) => prefix !== ""),
      locals: selection.usGaap,
    },
    {
      label: "extension",
      prefixes: prefixesFor(
        namespaces,
        (namespace) =>
          !STANDARD_NAMESPACE_PREFIXES.some((standard) =>
            namespace.startsWith(standard),
          ),
      ).filter((prefix) => prefix !== ""),
      locals: selection.extension,
    },
  ];
  const values = new Map<string, XbrlShareFact>();
  const conflicting = new Set<string>();

  for (const group of groups) {
    for (const local of group.locals) {
      if (!new RegExp(`^${NAME}$`, "u").test(local)) continue;
      for (const prefix of group.prefixes) {
        const pattern = new RegExp(
          `<${qualified(prefix)}${escape(local)}\\b([^>]*?)>([^<]*)</${qualified(prefix)}${escape(local)}>`,
          "gu",
        );

        for (const match of xml.matchAll(pattern)) {
          const attributes = match[1]!;
          const contextId = attribute(attributes, "contextRef");
          const unitId = attribute(attributes, "unitRef");
          const decimals = attribute(attributes, "decimals");
          const value = match[2]!.trim();
          const unit = unitId === null ? undefined : units.get(unitId);

          if (
            contextId === null ||
            unit === undefined ||
            !contexts.has(contextId) ||
            decimals === null ||
            (decimals !== "INF" && !DECIMALS.test(decimals)) ||
            !DECIMAL.test(value)
          ) {
            continue;
          }

          const concept = `${group.label}:${local}`;
          const key = `${concept}\u0000${contextId}\u0000${unit}`;
          const previous = values.get(key);

          if (previous === undefined) {
            values.set(key, {
              concept,
              contextId,
              unit,
              value,
              decimals: decimals === "INF" ? null : Number(decimals),
            });
          } else if (previous.value !== value) {
            conflicting.add(concept);
          }
        }
      }
    }
  }

  return {
    status: "read",
    read: {
      version: SEC_XBRL_SHARE_FACTS_VERSION,
      contexts,
      facts: [...values.values()].filter(
        (fact) => !conflicting.has(fact.concept),
      ),
      conflicting: [...conflicting].sort(),
    },
  };
}
