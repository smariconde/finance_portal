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
