import { CircleAlert, MapPin, Ruler } from "lucide-react";

import { InfoTip } from "@/app/_components/info-tip";
import { formatDateTime } from "@/app/_components/trading-format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { StoredListingLocation } from "@/modules/real-estate/application/location-store";
import {
  BUILDABLE_ENVELOPE_VERSION,
  FOT_SENSITIVITY,
  GROUND_FLOOR_HEIGHT_M,
  TYPICAL_FLOOR_HEIGHT_M,
  type BuildableEnvelope,
} from "@/modules/real-estate/domain/buildable-envelope";
import type { PropertyType } from "@/modules/real-estate/domain/listing-capture";
import {
  LISTING_LOCATION_VERSION,
  PARCEL_AREA_TOLERANCE,
  parcelAffirmed,
} from "@/modules/real-estate/domain/listing-location";
import { LOCATION_PRECISION_VERSION } from "@/modules/real-estate/domain/location-precision";
import {
  ENVELOPE_AREA_LABELS,
  ENVELOPE_UNAVAILABLE_LABELS,
  envelopeOf,
  formatFos,
  formatNomenclature,
  PARCEL_STATUS_LABELS,
  PRECISION_DETAILS,
  PRECISION_LABELS,
  ZONING_CONFIDENCE_LABELS,
  ZONING_MISSING_LABELS,
  ZONING_UNKNOWN_LABELS,
} from "@/modules/real-estate/domain/location-view";
import { ZONING_RESOLUTION_VERSION } from "@/modules/real-estate/domain/zoning-resolution";
import { formatAmount } from "@/modules/valuation/domain/display-format";

import { formatArea } from "./listing-format";

/** «624.00» → «624»: los m² de la envolvente sin decimales en cero. */
const m2 = (value: string | null) =>
  formatArea(value?.includes(".") ? value.replace(/\.?0+$/u, "") : value);

const decimal = (value: string) =>
  formatAmount(value, {
    scale: value.includes(".") ? Math.min(value.split(".")[1]!.length, 2) : 0,
  });

/**
 * Dónde está el aviso y qué admite su suelo (`F13-06`): la ubicación con su
 * precisión, el barrio y la parcela; la zona de la Ord. 8256 con su confianza
 * y la envolvente del lote con el FOT movido ±0,3. Lo que falta se nombra.
 */
export function LocationSection({
  location,
  propertyType,
  landAreaM2,
}: {
  readonly location: StoredListingLocation | null;
  readonly propertyType: PropertyType;
  readonly landAreaM2: string | null;
}) {
  return (
    <section aria-labelledby="location-title" className="flex flex-col gap-3">
      <h2
        id="location-title"
        className="flex items-center gap-0.5 text-lg font-semibold"
      >
        Ubicación y suelo
        <InfoTip title="Cómo se lee">
          <p>
            El barrio y la zona salen del mejor punto que haya; la parcela, sólo
            de una dirección exacta o un pin propio.
          </p>
          <p>
            Reglas{" "}
            <code className="font-mono">{LOCATION_PRECISION_VERSION}</code>,{" "}
            <code className="font-mono">{ZONING_RESOLUTION_VERSION}</code> y{" "}
            <code className="font-mono">{LISTING_LOCATION_VERSION}</code>.
          </p>
        </InfoTip>
      </h2>
      {location === null ? (
        <p className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="size-4 shrink-0" />
          Todavía sin ubicar
        </p>
      ) : (
        <LocationBody
          location={location}
          propertyType={propertyType}
          landAreaM2={landAreaM2}
        />
      )}
    </section>
  );
}

function LocationBody({
  location,
  propertyType,
  landAreaM2,
}: {
  readonly location: StoredListingLocation;
  readonly propertyType: PropertyType;
  readonly landAreaM2: string | null;
}) {
  const { reading } = location;
  const { parcel, zoning } = reading;
  const envelope = envelopeOf({ reading, propertyType, landAreaM2 });
  const strongPrecision =
    reading.precision === "address_geocoded" ||
    reading.precision === "portal_pin";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
            <MapPin
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            Dónde
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">Precisión</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              <Badge variant={strongPrecision ? "secondary" : "outline"}>
                {PRECISION_LABELS[reading.precision]}
              </Badge>
              <InfoTip title={PRECISION_LABELS[reading.precision]}>
                <p>{PRECISION_DETAILS[reading.precision]}</p>
              </InfoTip>
              {reading.pinFarFromAddress &&
              reading.pinAddressDistanceM !== null ? (
                <span className="inline-flex items-center gap-1 text-xs text-warning">
                  <CircleAlert aria-hidden="true" className="size-3.5" />
                  <span className="numeric">
                    pin a{" "}
                    {formatAmount(String(reading.pinAddressDistanceM), {
                      scale: 0,
                    })}{" "}
                    m
                  </span>{" "}
                  de la dirección
                </span>
              ) : null}
            </dd>

            <dt className="text-muted-foreground">Barrio</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {reading.barrio === null ? (
                <span className="text-muted-foreground">
                  {reading.barrioReason === "outside_barrios"
                    ? "Fuera de los barrios"
                    : reading.barrioReason === "layer_unavailable"
                      ? "Capa sin bajar"
                      : "Sin punto"}
                </span>
              ) : (
                <>
                  <span className="font-medium">
                    {titleCase(reading.barrio.name)}
                  </span>
                  {reading.barrio.official ? null : (
                    <Badge variant="outline">no oficial</Badge>
                  )}
                </>
              )}
            </dd>

            {reading.geocode?.status === "matched" ? (
              <>
                <dt className="text-muted-foreground">Georef</dt>
                <dd className="numeric">
                  {titleCase(reading.geocode.streetName)}{" "}
                  {reading.geocode.number}
                </dd>
              </>
            ) : null}

            <dt className="text-muted-foreground">Parcela</dt>
            <dd className="flex flex-col gap-1">
              {parcel.candidate === null ? (
                <span className="text-muted-foreground">
                  {PARCEL_STATUS_LABELS[parcel.status]}
                </span>
              ) : (
                <>
                  <span className="numeric font-medium">
                    {formatNomenclature(parcel.candidate.nomenclature)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    {parcel.candidate.landAreaM2 === null ? null : (
                      <span className="numeric text-muted-foreground">
                        {formatArea(parcel.candidate.landAreaM2)}
                      </span>
                    )}
                    <Badge
                      variant={
                        parcelAffirmed(parcel.status) ? "secondary" : "outline"
                      }
                      className={cn(
                        parcel.status === "area_mismatch" &&
                          "border-warning-border bg-warning-surface text-warning",
                      )}
                    >
                      {PARCEL_STATUS_LABELS[parcel.status]}
                    </Badge>
                    {parcel.status === "area_mismatch" ||
                    parcel.status === "matched" ? (
                      <InfoTip title="Cómo se compara">
                        <p>
                          La superficie de la parcela contra el terreno del
                          aviso, con{" "}
                          {formatAmount(String(PARCEL_AREA_TOLERANCE * 100), {
                            scale: 0,
                          })}{" "}
                          % de tolerancia.
                        </p>
                        <p>
                          Si no coincide, la parcela queda como candidata y la
                          envolvente usa el terreno del aviso.
                        </p>
                      </InfoTip>
                    ) : null}
                  </span>
                </>
              )}
            </dd>
          </dl>
        </div>

        <ZoningPanel zoning={zoning} />
      </div>

      {envelope === null ? null : <EnvelopePanel envelope={envelope} />}

      <p className="text-xs text-muted-foreground">
        Fuentes: Georef (CC BY 4.0), IDECOR (CC BY-SA 4.0) y Municipalidad de
        Córdoba, barrios 2023 (CC BY-SA) · leído{" "}
        <time dateTime={location.resolvedAt}>
          {formatDateTime(location.resolvedAt)}
        </time>
      </p>
    </div>
  );
}

function ZoningPanel({
  zoning,
}: {
  readonly zoning: StoredListingLocation["reading"]["zoning"];
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 flex flex-wrap items-center gap-1.5 text-sm font-medium">
        <Ruler aria-hidden="true" className="size-4 text-muted-foreground" />
        Qué admite
        <Badge
          variant={zoning.confidence === "unknown" ? "outline" : "secondary"}
          className="ml-1"
        >
          {ZONING_CONFIDENCE_LABELS[zoning.confidence]}
        </Badge>
        <InfoTip title="Confianza">
          <p>Consulta al municipio: el único documento oficial.</p>
          <p>Mapa oficial: el punto cae en un polígono de la Ord. 8256.</p>
          <p>Inferida: todos los polígonos a 25 m son de la misma zona.</p>
        </InfoTip>
      </h3>
      {zoning.confidence === "unknown" ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            {ZONING_UNKNOWN_LABELS[zoning.reason]}
          </p>
          {zoning.candidates.length > 0 ? (
            <ul aria-label="Zonas cercanas" className="flex flex-wrap gap-1.5">
              {zoning.candidates.map((candidate) => (
                <li key={candidate}>
                  <Badge variant="outline">{candidate}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-semibold">{zoning.pattern}</span>
            {zoning.zone === null ? null : (
              <span className="text-muted-foreground">{zoning.zone}</span>
            )}
            {zoning.character === null ? null : (
              <InfoTip title="Carácter urbanístico" wide>
                <p>{zoning.character}</p>
              </InfoTip>
            )}
          </p>
          <dl className="grid grid-cols-4 gap-2">
            <Parameter
              term="FOS"
              value={
                zoning.parameters.fos === null
                  ? null
                  : formatFos(zoning.parameters.fos)
              }
            />
            <Parameter
              term="FOT"
              value={
                zoning.parameters.fot === null
                  ? null
                  : decimal(zoning.parameters.fot)
              }
            />
            <Parameter
              term="Altura"
              value={
                zoning.parameters.heightMaxM === null
                  ? null
                  : `${decimal(zoning.parameters.heightMaxM)} m`
              }
            />
            <Parameter
              term="Plantas"
              value={
                zoning.parameters.floorsMax === null
                  ? null
                  : String(zoning.parameters.floorsMax)
              }
            />
          </dl>
          {zoning.missing.some((code) => code !== "special_agreement") &&
          !zoning.missing.includes("special_agreement") ? (
            <p className="text-xs text-muted-foreground">
              No publica:{" "}
              {zoning.missing
                .map((code) => ZONING_MISSING_LABELS[code])
                .join(", ")}
            </p>
          ) : null}
          {zoning.missing.includes("special_agreement") ? (
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <CircleAlert aria-hidden="true" className="size-3.5" />
              Convenio urbanístico: los parámetros salen del convenio
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {zoning.ordinance} · {zoning.evidence} ·{" "}
            <time dateTime={zoning.observedAt}>
              {formatDateTime(zoning.observedAt)}
            </time>
          </p>
        </div>
      )}
    </div>
  );
}

function Parameter({
  term,
  value,
}: {
  readonly term: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-2.5 py-2">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd
        className={cn(
          "numeric text-base font-semibold",
          value === null && "font-normal text-muted-foreground",
        )}
      >
        {value ?? "—"}
        {value === null ? <span className="sr-only">sin publicar</span> : null}
      </dd>
    </div>
  );
}

function EnvelopePanel({ envelope }: { readonly envelope: BuildableEnvelope }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 flex flex-wrap items-center gap-1.5 text-sm font-medium">
        Envolvente construible
        <InfoTip title="Cómo se calcula">
          <p>Planta = FOS × terreno. Total = FOT × terreno.</p>
          <p>
            Por altura = planta × plantas; sin pisos publicados, plantas desde
            la altura ({decimal(GROUND_FLOOR_HEIGHT_M)} m de planta baja,{" "}
            {decimal(TYPICAL_FLOOR_HEIGHT_M)} m por piso).
          </p>
          <p>
            Construible = el menor. Regla{" "}
            <code className="font-mono">{BUILDABLE_ENVELOPE_VERSION}</code>.
          </p>
        </InfoTip>
      </h3>
      {envelope.status === "unavailable" ? (
        <p className="text-sm text-muted-foreground">
          {ENVELOPE_UNAVAILABLE_LABELS[envelope.reason]}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <p className="flex flex-col">
              <span className="text-xs text-muted-foreground">Construible</span>
              <span className="numeric text-2xl font-semibold">
                {m2(envelope.buildableM2)}
              </span>
              <span className="text-xs text-muted-foreground">
                manda {envelope.binding === "fot" ? "el FOT" : "la altura"}
              </span>
            </p>
            <Figure label="Terreno" value={m2(envelope.landAreaM2)}>
              {ENVELOPE_AREA_LABELS[envelope.areaBasis]}
            </Figure>
            <Figure label="Planta máxima" value={m2(envelope.footprintMaxM2)} />
            <Figure
              label="Por altura"
              value={m2(envelope.heightBoundM2) ?? "—"}
            >
              {envelope.floors === null
                ? null
                : `${envelope.floors} plantas${envelope.floorsBasis === "from_height" ? ", desde la altura" : ""}`}
            </Figure>
          </div>
          {envelope.sensitivity.length > 0 ? (
            <Table containerLabel="Sensibilidad al FOT, tabla desplazable">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    FOT ±{decimal(FOT_SENSITIVITY)}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Construible
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {envelope.sensitivity.map((row) => {
                  const base = row.fot === envelope.fot;
                  return (
                    <TableRow
                      key={row.fot}
                      className={cn(base && "bg-muted/40")}
                    >
                      <TableCell className="numeric">
                        {decimal(row.fot)}
                        {base ? (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            publicado
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="numeric text-right">
                        {m2(row.buildableM2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  children,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly children?: React.ReactNode;
}) {
  return (
    <p className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="numeric text-base font-medium">{value ?? "—"}</span>
      {children ? (
        <span className="text-xs text-muted-foreground">{children}</span>
      ) : null}
    </p>
  );
}

/** «HEROES DE VILCAPUGIO» → «Heroes De Vilcapugio» para leer. */
function titleCase(text: string): string {
  return text
    .toLocaleLowerCase("es-AR")
    .replace(
      /(^|\s)(\p{L})/gu,
      (_, space: string, letter: string) =>
        `${space}${letter.toLocaleUpperCase("es-AR")}`,
    );
}
