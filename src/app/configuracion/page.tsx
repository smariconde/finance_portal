import type { Metadata } from "next";

import {
  StatusMark,
  type AvailabilityStatus,
} from "@/app/_components/status-mark";
import { getAppConfigHealth } from "@/server/config/app-environment";

export const metadata: Metadata = {
  title: "Configuración | Portal Financiero",
  description: "Estado seguro de configuración y capacidades del portal.",
};

const stateGuide: Array<{
  status: AvailabilityStatus;
  meaning: string;
}> = [
  {
    status: "ready",
    meaning: "La capacidad puede usarse dentro del alcance actual.",
  },
  {
    status: "degraded",
    meaning: "La app sigue operativa, pero hay una condición para revisar.",
  },
  {
    status: "disabled",
    meaning: "La capacidad existe como contrato, pero está bloqueada por modo.",
  },
  {
    status: "planned",
    meaning: "Pertenece al roadmap y todavía no se implementó.",
  },
];

export default function ConfigurationPage() {
  const health = getAppConfigHealth();

  return (
    <main className="configuration-page" id="contenido">
      <section className="configuration-intro" aria-labelledby="config-title">
        <div>
          <h1 id="config-title">
            Saber qué está listo también es parte del análisis.
          </h1>
          <p>
            Este diagnóstico lee únicamente nombres y presencia de configuración
            server-only. Nunca devuelve credenciales, conexiones ni payloads.
          </p>
        </div>
        <dl className="runtime-plate">
          <div>
            <dt>Modo efectivo</dt>
            <dd>{health.mode}</dd>
          </div>
          <div>
            <dt>Límite de acceso</dt>
            <dd>{health.access}</dd>
          </div>
          <div>
            <dt>Controles</dt>
            <dd>{health.items.length}</dd>
          </div>
        </dl>
      </section>

      <section className="state-section" aria-labelledby="states-title">
        <div className="section-heading compact-heading">
          <h2 id="states-title">Cuatro estados, una lectura.</h2>
          <p>La forma y el texto conservan el significado aun sin color.</p>
        </div>
        <div className="state-band">
          {stateGuide.map((state) => (
            <div key={state.status}>
              <StatusMark status={state.status} />
              <p>{state.meaning}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        className="diagnostic-section"
        aria-labelledby="diagnostic-title"
      >
        <div className="section-heading compact-heading">
          <h2 id="diagnostic-title">Diagnóstico de esta instancia.</h2>
          <p>Los faltantes muestran nombres de variables, nunca sus valores.</p>
        </div>

        <div
          className="health-register"
          role="table"
          aria-label="Salud de configuración"
        >
          <div className="health-row health-header" role="row">
            <span role="columnheader">Componente</span>
            <span role="columnheader">Estado</span>
            <span role="columnheader">Lectura</span>
            <span role="columnheader">Configuración</span>
          </div>
          {health.items.map((item) => (
            <div className="health-row" role="row" key={item.id}>
              <strong role="cell" data-label="Componente">
                {item.label}
              </strong>
              <span role="cell" data-label="Estado">
                <StatusMark status={item.status} />
              </span>
              <p role="cell" data-label="Lectura">
                {item.message}
              </p>
              <code role="cell" data-label="Configuración">
                {item.missingVariables.length > 0
                  ? item.missingVariables.join(" · ")
                  : "Sin faltantes"}
              </code>
            </div>
          ))}
        </div>
      </section>

      <section className="boundary-section" aria-labelledby="boundary-title">
        <div>
          <h2 id="boundary-title">Límite actual del sistema.</h2>
          <p>
            F1-02 incorpora el contrato de persistencia. Postgres sólo se abre
            en modo personal; la demo permanece aislada en fixtures.
          </p>
        </div>
        <ul>
          <li>Postgres requiere modo personal y una conexión pooled.</li>
          <li>Sin proveedores ni tráfico externo.</li>
          <li>Sin ingestas, mutaciones persistentes o datos financieros.</li>
          <li>Sin rutas que simulen capacidades futuras.</li>
        </ul>
      </section>
    </main>
  );
}
