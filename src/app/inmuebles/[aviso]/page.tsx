import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataUnavailableNotice } from "@/app/_components/data-unavailable-notice";
import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { RouteLoading } from "@/app/_components/route-loading";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { ChangeIndicator, StatTile } from "@/app/_components/stat-tile";
import { formatDateTime } from "@/app/_components/trading-format";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import type { StoredListingHistory } from "@/modules/real-estate/application/listing-store";
import type { StoredListingLocation } from "@/modules/real-estate/application/location-store";
import {
  AMENITY_LABELS,
  CHANGE_LABELS,
  CONDITION_LABELS,
  LEGAL_FLAG_LABELS,
  LISTING_VIEW_VERSION,
  OPERATION_LABELS,
  PAGE_KIND_LABELS,
  PARSE_BASIS_LABELS,
  PORTAL_LABELS,
  PROPERTY_TYPE_LABELS,
  parseListingSlug,
  priceCuts,
  priceHistory,
  type PriceHistoryEntry,
} from "@/modules/real-estate/domain/listing-view";
import { formatPercent } from "@/modules/valuation/domain/display-format";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getListingStore } from "@/server/persistence/get-listing-store";
import { getLocationStore } from "@/server/persistence/get-location-store";

import { formatArea, formatListingPrice } from "../_components/listing-format";
import { LocationRefresh } from "../_components/location-refresh";
import { LocationSection } from "../_components/location-section";

export const metadata: Metadata = {
  title: "Aviso | Inmuebles | Portal Financiero",
  robots: { index: false },
};

/** Ver [ADR 0005](../../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

type PageProps = { readonly params: Promise<{ aviso: string }> };

/**
 * La ficha mínima de un aviso (`F13-02`): lo último que publica y su
 * historial de precio, revisión por revisión. Sólo lee lo guardado; el
 * vínculo al portal abre la página original en otra pestaña.
 */
export default async function ListingPage({ params }: PageProps) {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) {
    return <RuntimeLockedNotice health={health} surface="La ficha del aviso" />;
  }
  const parsed = parseListingSlug(decodeURIComponent((await params).aviso));
  if (parsed === null) notFound();

  return (
    <Suspense
      fallback={<RouteLoading label="Cargando el aviso" shape="list" />}
    >
      <ListingSheet source={parsed.source} externalId={parsed.externalId} />
    </Suspense>
  );
}

async function ListingSheet({
  source,
  externalId,
}: {
  readonly source: Parameters<
    ReturnType<typeof getListingStore>["readListing"]
  >[0];
  readonly externalId: string;
}) {
  let listing: StoredListingHistory | null;
  let location: StoredListingLocation | null;
  try {
    [listing, location] = await Promise.all([
      getListingStore().readListing(source, externalId),
      getLocationStore().readListingLocation(source, externalId),
    ]);
  } catch (error) {
    console.error(
      "listing read failed",
      error instanceof Error ? error.name : typeof error,
    );
    return <DataUnavailableNotice surface="La ficha del aviso" />;
  }
  if (listing === null) notFound();

  const latest = listing.revisions[listing.revisions.length - 1];
  const facts = latest.facts;
  const history = priceHistory(listing.revisions);
  const cuts = priceCuts(history);
  // El primer precio publicado, si fue otro en la misma moneda: «desde …».
  const firstPublished = [...history]
    .reverse()
    .find((entry) => entry.priceAmount !== null);
  const movedFromFirst =
    firstPublished !== undefined &&
    facts.priceAmount !== null &&
    firstPublished.priceCurrency === facts.priceCurrency &&
    firstPublished.priceAmount !== facts.priceAmount
      ? firstPublished
      : null;
  const portal = PORTAL_LABELS[listing.source];

  return (
    <PageContainer>
      <PageHeader
        id="listing-title"
        title={facts.addressDeclared ?? "Sin dirección publicada"}
        lead={[
          PROPERTY_TYPE_LABELS[facts.propertyType],
          OPERATION_LABELS[facts.operation],
          facts.neighborhood,
          facts.agency,
        ]
          .filter((part): part is string => part !== null)
          .join(" · ")}
        actions={
          <a
            href={listing.canonicalUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonVariants({ variant: "outline" })}
          >
            Ver en {portal}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        }
      >
        <p className="numeric text-xs text-muted-foreground">
          Visto por primera vez{" "}
          <time dateTime={listing.firstSeenAt}>
            {formatDateTime(listing.firstSeenAt)}
          </time>{" "}
          · última vez{" "}
          <time dateTime={listing.lastSeenAt}>
            {formatDateTime(listing.lastSeenAt)}
          </time>
        </p>
      </PageHeader>

      <section
        aria-label="Lo que publica hoy"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
      >
        <StatTile
          label="Precio"
          value={formatListingPrice(facts.priceAmount, facts.priceCurrency)}
          change={
            movedFromFirst === null ? undefined : (
              <SinceFirstChange first={movedFromFirst} />
            )
          }
          detail={
            cuts > 0 ? `${cuts} ${cuts === 1 ? "baja" : "bajas"}` : undefined
          }
          className="col-span-2"
        />
        <StatTile
          label="Expensas"
          value={
            facts.expensesAmount === null
              ? "—"
              : formatListingPrice(facts.expensesAmount, facts.expensesCurrency)
          }
          size="sm"
        />
        <StatTile
          label="Cubierta"
          value={formatArea(facts.coveredAreaM2) ?? "—"}
          size="sm"
        />
        <StatTile
          label={facts.landAreaM2 === null ? "Total" : "Terreno"}
          value={formatArea(facts.landAreaM2 ?? facts.totalAreaM2) ?? "—"}
          size="sm"
        />
        <StatTile
          label="Ambientes"
          value={facts.rooms ?? "—"}
          detail={
            [
              facts.bedrooms === null ? null : `${facts.bedrooms} dorm.`,
              facts.bathrooms === null ? null : `${facts.bathrooms} baños`,
              facts.parkingSpaces === null || facts.parkingSpaces === 0
                ? null
                : `${facts.parkingSpaces} cochera${facts.parkingSpaces === 1 ? "" : "s"}`,
            ]
              .filter((part) => part !== null)
              .join(" · ") || undefined
          }
          size="sm"
        />
      </section>

      <section
        aria-label="Rasgos"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        {facts.condition === "unknown" ? null : (
          <Badge variant="outline">{CONDITION_LABELS[facts.condition]}</Badge>
        )}
        {facts.ageYears === null ? null : (
          <Badge variant="outline" className="numeric">
            {facts.ageYears} años
          </Badge>
        )}
        {facts.legalFlags.map((flag) => (
          <Badge key={flag} variant="secondary">
            {LEGAL_FLAG_LABELS[flag]}
          </Badge>
        ))}
        {facts.amenities.map((amenity) => (
          <Badge key={amenity} variant="outline">
            {AMENITY_LABELS[amenity]}
          </Badge>
        ))}
      </section>

      <LocationRefresh />

      <LocationSection
        location={location}
        propertyType={facts.propertyType}
        landAreaM2={facts.landAreaM2}
      />

      <section aria-labelledby="history-title" className="flex flex-col gap-3">
        <h2
          id="history-title"
          className="flex items-center gap-0.5 text-lg font-semibold"
        >
          Historial
          <span className="numeric ml-1.5 text-sm font-normal text-muted-foreground">
            {listing.revisions.length}
          </span>
          <InfoTip title="Qué es una revisión">
            <p>
              Una revisión por cada vez que el aviso cambió algo. Verlo igual no
              suma una fila: sólo mueve «última vez».
            </p>
            <p>
              Regla <code className="font-mono">{LISTING_VIEW_VERSION}</code>.
            </p>
          </InfoTip>
        </h2>
        <Table containerLabel="Historial del aviso, tabla desplazable">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Visto</TableHead>
              <TableHead scope="col">Desde</TableHead>
              <TableHead scope="col" className="text-right">
                Precio
              </TableHead>
              <TableHead scope="col" className="text-right">
                Variación
              </TableHead>
              <TableHead scope="col">Cambió</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((entry) => (
              <TableRow key={entry.revision}>
                <TableCell className="numeric whitespace-nowrap">
                  <time dateTime={entry.observedAt}>
                    {formatDateTime(entry.observedAt)}
                  </time>
                </TableCell>
                <TableCell>{PAGE_KIND_LABELS[entry.pageKind]}</TableCell>
                <TableCell className="numeric text-right whitespace-nowrap">
                  {formatListingPrice(entry.priceAmount, entry.priceCurrency)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <HistoryChange entry={entry} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {entry.changes.length === 0
                    ? "Primer avistaje"
                    : entry.changes
                        .map((change) => CHANGE_LABELS[change])
                        .join(", ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <p className="text-xs text-muted-foreground">
        Fuente: {portal}, capturado al ver la página · leído del{" "}
        {PARSE_BASIS_LABELS[latest.parseBasis]} · {facts.photoCount} fotos
        publicadas
      </p>
    </PageContainer>
  );
}

function SinceFirstChange({ first }: { readonly first: PriceHistoryEntry }) {
  return (
    <span className="text-xs text-muted-foreground">
      desde {formatListingPrice(first.priceAmount, first.priceCurrency)}
    </span>
  );
}

const GAP_COPY: Record<NonNullable<PriceHistoryEntry["changeGap"]>, string> = {
  first: "—",
  on_request: "consultar",
  currency_changed: "otra moneda",
};

function HistoryChange({ entry }: { readonly entry: PriceHistoryEntry }) {
  if (entry.change === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {entry.changeGap === null ? "—" : GAP_COPY[entry.changeGap]}
      </span>
    );
  }
  if (entry.change === "0") {
    return <span className="text-xs text-muted-foreground">sin cambio</span>;
  }
  const text = formatPercent(entry.change, { scale: 1 });
  return (
    <ChangeIndicator
      amount={entry.change}
      text={entry.change.startsWith("-") ? text : `+${text}`}
      polarity="neutral"
    />
  );
}
