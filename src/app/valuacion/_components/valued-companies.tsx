import { DatabaseZap } from "lucide-react";

import { InfoTip } from "@/app/_components/info-tip";
import { companyLogoAssetUrl } from "@/modules/configuration/domain/company-logo";
import {
  VALUED_COMPANIES_VERSION,
  type ValuedCompaniesReading,
} from "@/modules/valuation/application/read-valued-companies";
import { readValuedCompaniesForRequest } from "@/server/jobs/valuation-job";

import { ValuedCompaniesTable } from "./valued-companies-table";

function Heading({ count }: { count: number | null }) {
  return (
    <div className="flex items-center gap-0.5">
      <h2 id="valued-title" className="text-lg font-semibold">
        Empresas valuadas
      </h2>
      {count === null ? null : (
        <span className="numeric ml-1.5 text-sm text-muted-foreground">
          {count}
        </span>
      )}
      <InfoTip title="Qué muestra la lista">
        <p>
          La última corrida de cada empresa, con su estado. El precio es el
          cierre guardado el día de esa corrida: otro día no se usa en su lugar.
        </p>
        <p>
          Precio ÷ valor 1× es pagar lo que el modelo calcula. Abrir la lista no
          baja datos ni vuelve a valuar.
        </p>
        <p>
          Regla <code className="font-mono">{VALUED_COMPANIES_VERSION}</code>.
        </p>
      </InfoTip>
    </div>
  );
}

/**
 * Lo ya valuado (decisión del owner del 2026-11-16): la última corrida de
 * cada empresa. Se lee aparte del formulario, así que una base caída deja el
 * formulario en pie y dice acá que la lista no está.
 */
export async function ValuedCompanies() {
  let reading: ValuedCompaniesReading;

  try {
    reading = await readValuedCompaniesForRequest();
  } catch (error) {
    // Sólo el tipo: el mensaje puede traer host, puerto o SQL (`TM-02`).
    console.error(
      "valued companies read failed",
      error instanceof Error ? error.name : typeof error,
    );

    return (
      <section aria-labelledby="valued-title" className="flex flex-col gap-3">
        <Heading count={null} />
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <DatabaseZap aria-hidden="true" className="size-4 shrink-0" />
          Lista no disponible: la base personal no respondió.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="valued-title" className="flex flex-col gap-3">
      <Heading count={reading.companies.length} />
      {reading.companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay corridas registradas.
        </p>
      ) : (
        <ValuedCompaniesTable
          companies={reading.companies.map((company) => ({
            ...company,
            logoUrl:
              company.ticker === null
                ? null
                : companyLogoAssetUrl(company.ticker),
          }))}
        />
      )}
    </section>
  );
}

/** Mientras la lista llega: el mismo alto aproximado, sin cifras inventadas. */
export function ValuedCompaniesSkeleton() {
  return (
    <section
      aria-labelledby="valued-title"
      aria-busy="true"
      className="flex flex-col gap-3"
    >
      <Heading count={null} />
      <div className="flex flex-col gap-2" aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="h-10 animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none"
          />
        ))}
      </div>
    </section>
  );
}
