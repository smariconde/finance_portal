import { EvidenceKindMark } from "@/app/valuacion/_components/run/data-marks";
import {
  CodeValue,
  Field,
  FieldList,
} from "@/app/valuacion/_components/run/field";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ValuationResultCedear } from "@/modules/valuation/application/read-valuation-result";
import {
  formatAmount,
  formatUtcTimestamp,
} from "@/modules/valuation/domain/display-format";

const STATUS_LABELS: Record<string, string> = {
  active: "Habilitado para emitir y cancelar",
  suspended: "Inhabilitado para emitir",
  terminated: "Dado de baja",
  unknown: "Sin estado reconocible",
};

const SCOPE_LABELS: Record<string, string> = {
  all_investors: "Cualquier inversor",
  qualified_only: "Sólo inversores calificados",
};

const UNAVAILABLE_LABELS: Record<string, string> = {
  no_value_per_share:
    "La corrida no tiene valor por acción, así que no hay qué convertir.",
  no_ratio: "El programa no tiene un ratio vigente al corte de la corrida.",
  invalid_ratio: "El ratio registrado no es positivo.",
};

function unitsLabel(value: string, singular: string, plural: string): string {
  return `${formatAmount(value, { scale: 0 })} ${value === "1" ? singular : plural}`;
}

/**
 * Acceso por CEDEAR a la security valuada (`F6-04`).
 *
 * El CEDEAR es otro instrumento, emitido por el depositario: la valuación
 * corre sobre la subyacente y esta sección sólo convierte su valor por acción
 * con el ratio vigente al corte de la corrida. No muestra el precio del CEDEAR
 * en BYMA ni el valor en pesos: el tipo al que cotiza sale de ese precio, y
 * es un slice posterior.
 */
export function CedearAccess({ cedear }: { cedear: ValuationResultCedear }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle as="h2">Acceso por CEDEAR</CardTitle>
        <CardDescription>
          Según el registro de los dos emisores autorizados, leído al corte de
          la corrida. El CEDEAR y la acción son instrumentos distintos; acá sólo
          se convierte el valor de la acción por el ratio.
        </CardDescription>
      </CardHeader>

      {cedear.status === "none_known" ? (
        <CardContent className="flex flex-col gap-2 text-sm">
          <EvidenceKindMark kind="declared_absent" className="w-fit" />
          <p className="text-muted-foreground">
            {cedear.reason === "no_program_recorded"
              ? "Ni Banco Comafi ni Caja de Valores listan un programa sobre esta acción."
              : "Hay programas registrados para esta acción, pero ninguno vigente al corte: o el corte es anterior a la primera vez que se lo vio, o el programa se retiró. No es lo mismo que «sin CEDEAR»."}
          </p>
          <p className="text-xs text-muted-foreground">
            <CodeValue>{cedear.rule}</CodeValue>
          </p>
        </CardContent>
      ) : (
        cedear.programs.map((program, index) => (
          <CardContent
            key={program.cedearIsin ?? index}
            className={cn(
              "grid gap-6 pt-(--card-spacing) lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]",
              // El header ya trae su borde: sólo los programas siguientes
              // se separan con uno propio.
              index > 0 && "border-t",
            )}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">
                  {program.depositaryName ?? "Depositario sin nombre declarado"}
                </h3>
                <EvidenceKindMark kind="reference_data" />
              </div>
              <FieldList className="sm:grid-cols-2">
                <Field
                  term="Ratio"
                  hint={
                    program.ratio === null
                      ? undefined
                      : `Conocido desde ${formatUtcTimestamp(program.ratio.availableAt)}`
                  }
                >
                  {program.ratio === null ? (
                    <span className="text-muted-foreground">
                      Sin ratio vigente
                    </span>
                  ) : (
                    <span className="numeric">
                      {unitsLabel(
                        program.ratio.depositaryUnits,
                        "CEDEAR",
                        "CEDEAR",
                      )}{" "}
                      ={" "}
                      {unitsLabel(
                        program.ratio.underlyingUnits,
                        "acción",
                        "acciones",
                      )}
                    </span>
                  )}
                </Field>
                <Field term="Estado del programa">
                  {STATUS_LABELS[program.status] ?? program.status}
                </Field>
                <Field term="Inversores">
                  {program.investorScope === null
                    ? "—"
                    : (SCOPE_LABELS[program.investorScope] ??
                      program.investorScope)}
                </Field>
                <Field
                  term="Visto por primera vez"
                  hint="Los emisores no fechan lo que publican"
                >
                  <time className="numeric" dateTime={program.programSeenAt}>
                    {formatUtcTimestamp(program.programSeenAt)}
                  </time>
                </Field>
                <Field term="ISIN del CEDEAR">
                  {program.cedearIsin === null ? (
                    "—"
                  ) : (
                    <CodeValue>{program.cedearIsin}</CodeValue>
                  )}
                </Field>
                <Field term="Código de Caja de Valores">
                  {program.cajaValoresCode === null ? (
                    "—"
                  ) : (
                    <CodeValue>{program.cajaValoresCode}</CodeValue>
                  )}
                </Field>
              </FieldList>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">Valor por CEDEAR</h3>
                <EvidenceKindMark kind="derived_by_rule" />
              </div>
              {program.equivalent.status === "computed" ? (
                <>
                  <p className="numeric flex flex-wrap items-baseline gap-2">
                    <span className="text-3xl font-semibold tracking-tight tabular-nums">
                      {formatAmount(program.equivalent.value)}
                    </span>
                    <span className="text-base font-medium text-muted-foreground">
                      {program.equivalent.currency}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Valor por acción × acciones por CEDEAR. Es el mismo
                    resultado en otra unidad, no un precio: el precio en BYMA y
                    el valor en pesos todavía no se leen.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {UNAVAILABLE_LABELS[program.equivalent.reason]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                <CodeValue>{program.equivalent.version}</CodeValue>{" "}
                <CodeValue>{cedear.rule}</CodeValue>
              </p>
            </div>
          </CardContent>
        ))
      )}
    </Card>
  );
}
