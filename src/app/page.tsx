import type { ConfigStatus } from "@/modules/configuration/domain/config-health";
import { getAppConfigHealth } from "@/server/config/app-environment";

const statusLabels: Record<ConfigStatus, string> = {
  ready: "Listo",
  degraded: "Requiere atención",
  disabled: "Deshabilitado",
};

export default function HomePage() {
  const health = getAppConfigHealth();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-10 sm:px-8 sm:py-16">
      <header className="max-w-3xl">
        <p className="eyebrow">Fase 0A · Bootstrap</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-balance sm:text-6xl">
          Portal Financiero
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
          La base técnica está en marcha. Cada número futuro tendrá fuente,
          fecha, unidad y una transformación reproducible.
        </p>
      </header>

      <section className="mt-12" aria-labelledby="configuration-health">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Modo {health.mode}</p>
            <h2
              id="configuration-health"
              className="mt-2 text-2xl font-semibold"
            >
              Salud de configuración
            </h2>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Ningún valor secreto se muestra en esta vista.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {health.items.map((item) => (
            <article className="health-card" key={item.id}>
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-medium">{item.label}</h3>
                <span className={`status status-${item.status}`}>
                  {statusLabels[item.status]}
                </span>
              </div>
              <p className="mt-5 text-sm leading-6 text-[var(--muted)]">
                {item.message}
              </p>
              {item.missingVariables.length > 0 ? (
                <p className="mt-4 font-mono text-xs text-[var(--warning)]">
                  Faltan: {item.missingVariables.join(", ")}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <footer className="mt-auto pt-16 text-sm leading-6 text-[var(--muted)]">
        Información educativa, no asesoramiento financiero. Las integraciones
        reales permanecen deshabilitadas hasta superar sus gates de datos y
        licencia.
      </footer>
    </main>
  );
}
