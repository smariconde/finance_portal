import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { readIndicatorVintages } from "@/modules/macro-series/domain/argentina-indicator";
import { DECLARED_INDEC_EXPANDED_INDICATORS } from "@/modules/macro-series/domain/declared-indec-expanded-indicators";
import { getArgentinaIndicatorRepository } from "@/server/persistence/get-argentina-indicator-repository";

import { amount, shortMonth } from "./format";

/** The expanded catalog is separate from the automatic refresh of F9-12. */
export async function ExpandedIndecOverview() {
  const now = new Date().toISOString();
  const ids = DECLARED_INDEC_EXPANDED_INDICATORS.map((item) => item.id);
  let summaries: readonly {
    id: string;
    label: string;
    value: string;
    period: string;
    basis: string;
  }[];

  try {
    const stored =
      await getArgentinaIndicatorRepository().allObservationsOf(ids);
    summaries = DECLARED_INDEC_EXPANDED_INDICATORS.map((item) => {
      const points = readIndicatorVintages(item, stored.get(item.id) ?? [], {
        effectiveOn: now.slice(0, 10),
        knownAt: now,
        knowledgeBasis: "system_recorded",
      }).filter((point) => point.missingReason !== "withdrawn");
      const latest = [...points]
        .reverse()
        .find((point) => point.value !== null);
      return {
        id: item.id,
        label: item.reportingScope,
        value:
          latest?.value == null
            ? "Sin dato publicado"
            : `${item.currency === "ARS" ? "$ " : ""}${amount(latest.value, 2)}${item.currency === "ARS" ? "" : " puntos"}`,
        period: latest ? shortMonth(latest.periodOn) : "—",
        basis: item.indexBase ?? "Pesos corrientes",
      };
    });
  } catch (error) {
    console.error(
      "indec expanded overview read failed",
      error instanceof Error ? error.name : typeof error,
    );
    return (
      <section id="indec-ampliado" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-lg">
              Precios y salarios del INDEC
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No se pudieron leer las series ampliadas de la base personal.
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section
      id="indec-ampliado"
      className="scroll-mt-20"
      aria-labelledby="indec-ampliado-title"
    >
      <Card>
        <CardHeader className="gap-2">
          <CardTitle as="h2" id="indec-ampliado-title" className="text-lg">
            Precios y salarios del INDEC
          </CardTitle>
          <p className="max-w-3xl text-sm">
            IPC por región y división, canastas, industria, mayoristas,
            construcción y salarios. Cada fila muestra el último mes guardado;
            abrí la historia para ver niveles, ausencias y revisiones.
          </p>
          <p className="text-xs text-muted-foreground">
            Fuente: INDEC, Catálogo API-INDEC · 28 series mensuales · cada base
            se muestra por separado · actualización manual
          </p>
          <p className="text-xs text-muted-foreground sm:hidden">
            Deslizá la tabla para ver nivel, mes y base; tocá el nombre para
            abrir la historia.
          </p>
        </CardHeader>
        <CardContent>
          <div
            role="region"
            aria-label="Últimos niveles de las series ampliadas del INDEC"
            tabIndex={0}
            className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Table>
              <TableCaption className="sr-only">
                Último nivel guardado, mes y base de las 28 series ampliadas del
                INDEC
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Serie</TableHead>
                  <TableHead scope="col" className="text-right">
                    Último nivel
                  </TableHead>
                  <TableHead scope="col">Mes</TableHead>
                  <TableHead scope="col">Base</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.map((item) => (
                  <TableRow key={item.id}>
                    <TableHead scope="row" className="min-w-64 font-normal">
                      <Link
                        href={{
                          pathname: "/argentina/indec",
                          query: { serie: item.id },
                        }}
                        className="font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {item.label}
                      </Link>
                    </TableHead>
                    <TableCell className="numeric whitespace-nowrap text-right">
                      {item.value}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {item.period}
                    </TableCell>
                    <TableCell className="min-w-44">{item.basis}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
