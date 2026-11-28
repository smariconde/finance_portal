import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { InfoTip } from "@/app/_components/info-tip";
import { PageContainer, PageHeader } from "@/app/_components/page-frame";
import { RouteLoading } from "@/app/_components/route-loading";
import { RuntimeLockedNotice } from "@/app/_components/runtime-locked-notice";
import { formatDateTime } from "@/app/_components/trading-format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import type { StoredListing } from "@/modules/real-estate/domain/listing-revisions";
import {
  CONDITION_LABELS,
  OPERATION_LABELS,
  PORTAL_LABELS,
  PROPERTY_TYPE_LABELS,
  listingSlug,
} from "@/modules/real-estate/domain/listing-view";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import { getListingStore } from "@/server/persistence/get-listing-store";

import { formatArea, formatListingPrice } from "./_components/listing-format";
import { ListingsUnavailable } from "./_components/listings-unavailable";
import { LocationRefresh } from "./_components/location-refresh";

export const metadata: Metadata = {
  title: "Inmuebles | Portal Financiero",
  description:
    "Los avisos inmobiliarios que capturó la extensión, con su historial.",
};

/** Ver [ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md). */
export const instant = false;

const RECENT_LIMIT = 100;

/**
 * Los avisos vistos más recientemente (`F13-02`, ADR 0089). La extensión los
 * captura al verlos; esta página sólo lee lo guardado, nunca va al portal.
 * La superficie completa —lo nuevo, el mapa, la banda— es `F13-10`.
 */
export default async function RealEstatePage() {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) {
    return (
      <RuntimeLockedNotice health={health} surface="Los avisos inmobiliarios" />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        id="inmuebles-title"
        title="Inmuebles"
        lead={
          <>
            Avisos vistos en el navegador, con su historial
            <InfoTip title="De dónde salen">
              <p>
                La extensión del perfil Inmuebles de Brave lee cada ficha y
                listado que se abre y los envía acá. Una revisión nueva sólo
                aparece cuando algo del aviso cambió.
              </p>
            </InfoTip>
          </>
        }
      />
      <LocationRefresh />
      <Suspense
        fallback={<RouteLoading label="Cargando los avisos" shape="list" />}
      >
        <RecentListings />
      </Suspense>
    </PageContainer>
  );
}

async function RecentListings() {
  let listings: readonly StoredListing[];
  try {
    listings = await getListingStore().listRecent(RECENT_LIMIT);
  } catch (error) {
    // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
    console.error(
      "listings read failed",
      error instanceof Error ? error.name : typeof error,
    );
    return <ListingsUnavailable />;
  }

  if (listings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay avisos: se capturan al abrir una ficha o un listado en el
        perfil Inmuebles.
      </p>
    );
  }

  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-3">
      <h2
        id="recent-title"
        className="flex items-baseline gap-1.5 text-lg font-semibold"
      >
        Vistos últimamente
        <span className="numeric text-sm font-normal text-muted-foreground">
          {listings.length}
        </span>
      </h2>
      <Table containerLabel="Avisos vistos últimamente, tabla desplazable">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Aviso</TableHead>
            <TableHead scope="col" className="text-right">
              Precio
            </TableHead>
            <TableHead scope="col" className="text-right">
              Cubierta
            </TableHead>
            <TableHead scope="col" className="text-right">
              Terreno
            </TableHead>
            <TableHead scope="col" className="text-right">
              Amb.
            </TableHead>
            <TableHead scope="col">Estado</TableHead>
            <TableHead scope="col" className="text-right">
              Rev.
            </TableHead>
            <TableHead scope="col">Visto</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((listing) => {
            const facts = listing.latest.facts;
            return (
              <TableRow key={`${listing.source}:${listing.externalId}`}>
                <TableCell className="max-w-72">
                  <Link
                    href={
                      `/inmuebles/${listingSlug(listing.source, listing.externalId)}` as Route
                    }
                    className="block truncate font-medium underline-offset-4 hover:underline"
                  >
                    {facts.addressDeclared ?? "Sin dirección publicada"}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {PROPERTY_TYPE_LABELS[facts.propertyType]} ·{" "}
                    {OPERATION_LABELS[facts.operation]} ·{" "}
                    {PORTAL_LABELS[listing.source]}
                  </span>
                </TableCell>
                <TableCell className="numeric text-right whitespace-nowrap">
                  {formatListingPrice(facts.priceAmount, facts.priceCurrency)}
                </TableCell>
                <TableCell className="numeric text-right whitespace-nowrap">
                  {formatArea(facts.coveredAreaM2) ?? "—"}
                </TableCell>
                <TableCell className="numeric text-right whitespace-nowrap">
                  {formatArea(facts.landAreaM2) ?? "—"}
                </TableCell>
                <TableCell className="numeric text-right">
                  {facts.rooms ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {CONDITION_LABELS[facts.condition]}
                </TableCell>
                <TableCell className="numeric text-right">
                  {listing.latest.revision}
                </TableCell>
                <TableCell className="numeric whitespace-nowrap text-muted-foreground">
                  <time dateTime={listing.lastSeenAt}>
                    {formatDateTime(listing.lastSeenAt)}
                  </time>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
