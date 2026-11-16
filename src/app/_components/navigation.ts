/**
 * El mapa del portal, compartido por la sidebar y la ubicación del header para
 * que los dos nombren igual cada lugar. Sin íconos: la sidebar los pone por
 * `href`, así esto se puede probar sin React.
 */
export type NavItem = { readonly href: string; readonly label: string };

export type NavSection = {
  readonly label: string;
  readonly items: readonly NavItem[];
};

export const HOME_ITEM: NavItem = { href: "/", label: "Inicio" };

export const SETTINGS_ITEM: NavItem = {
  href: "/configuracion",
  label: "Configuración",
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Análisis",
    items: [
      { href: "/valuacion", label: "Valuación" },
      { href: "/sectores", label: "Matrices" },
      { href: "/argentina", label: "Argentina" },
    ],
  },
  {
    // La cuenta Schwab y lo que se arma con ella (Fase 11, ADR 0076).
    label: "Trading",
    items: [
      { href: "/cuenta", label: "Cuenta" },
      { href: "/plan", label: "Plan" },
      { href: "/diario", label: "Diario" },
      { href: "/lecciones", label: "Lecciones" },
    ],
  },
];

/** `/plan` cubre `/plan/finviz`, pero no una ruta que sólo empiece igual. */
export function isWithin(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Un paso de la ubicación; `href` es `null` en la página actual y en la sección, que no es una página. */
export type Crumb = { readonly label: string; readonly href: string | null };

const FIXED_SEGMENTS: Readonly<Record<string, string>> = {
  referencia: "Corrida de referencia",
  divergencias: "Divergencias",
  finviz: "Finviz",
  estadisticas: "Estadísticas",
};

/**
 * El segmento dinámico de cada sección, como lo nombra su página. El sector se
 * escribe desde su código (`information-technology` → «Information
 * Technology», que es exactamente su rótulo); un trade o una lección dicen qué
 * son y su `h1` dice cuál.
 */
const DYNAMIC_SEGMENT: Readonly<Record<string, (segment: string) => string>> = {
  "/valuacion": (segment) => segment.toUpperCase(),
  "/sectores": (segment) =>
    segment
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" "),
  "/diario": () => "Trade",
  "/lecciones": () => "Lección",
};

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Dónde está el owner: sección › página › lo que haya debajo. Una ruta que el
 * mapa no conoce devuelve una lista vacía y el header muestra el nombre del
 * portal, en vez de inventar un lugar.
 */
export function breadcrumbsFor(pathname: string): readonly Crumb[] {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (path === HOME_ITEM.href) return [{ label: HOME_ITEM.label, href: null }];
  if (path === SETTINGS_ITEM.href) {
    return [{ label: SETTINGS_ITEM.label, href: null }];
  }

  for (const section of NAV_SECTIONS) {
    const item = section.items.find((candidate) =>
      isWithin(path, candidate.href),
    );
    if (item === undefined) continue;

    const crumbs: Crumb[] = [
      { label: section.label, href: null },
      { label: item.label, href: item.href },
    ];
    let href = item.href;
    for (const segment of path.slice(item.href.length + 1).split("/")) {
      if (segment === "") continue;
      const label =
        FIXED_SEGMENTS[segment] ??
        DYNAMIC_SEGMENT[item.href]?.(decoded(segment));
      if (label === undefined) break;
      href = `${href}/${segment}`;
      crumbs.push({ label, href });
    }

    const last = crumbs.at(-1);
    if (last !== undefined) crumbs[crumbs.length - 1] = { ...last, href: null };
    return crumbs;
  }

  return [];
}
