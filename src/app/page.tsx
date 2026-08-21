import type { ConfigStatus } from "@/modules/configuration/domain/config-health";
import { getAppConfigHealth } from "@/server/config/app-environment";

const statusLabels: Record<ConfigStatus, string> = {
  ready: "Listo",
  degraded: "Requiere atención",
  disabled: "Deshabilitado",
};

const tools = [
  {
    phase: "Fase 1",
    area: "Empresas · CEDEAR",
    question: "¿Qué empresas cumplen mis criterios?",
    description:
      "Filtrá por fundamentales actuales e históricos sin perder de vista cobertura, fecha y calidad.",
    output: "Screener + ficha",
  },
  {
    phase: "Fase 2",
    area: "Matrices · Divergencias",
    question: "¿Dónde se separaron precio y fundamentales?",
    description:
      "Explorá la matriz, compará períodos y abrí el puente entre resultados, precio y cantidad de acciones.",
    output: "Matriz + tabla",
  },
  {
    phase: "Fase 3",
    area: "Valuación",
    question: "¿Qué valor explican estos supuestos?",
    description:
      "Construí escenarios reproducibles y contrastá el rango de valor intrínseco con el precio observado.",
    output: "Workbench",
  },
  {
    phase: "Fase 4",
    area: "Argentina · Macro",
    question: "¿Qué está cambiando en el régimen local?",
    description:
      "Leé nominalidad, liquidez, dólares, actividad y sector externo por preguntas, no como una pared de gráficos.",
    output: "Tablero por bloques",
  },
  {
    phase: "Fase 4",
    area: "Agro · Soja",
    question: "¿Qué cuenta hoy el precio de la soja?",
    description:
      "Compará Rosario y Chicago, el basis y el percentil histórico con unidad, ventana y fuente visibles.",
    output: "Serie + contexto",
  },
] as const;

export default function HomePage() {
  const health = getAppConfigHealth();

  return (
    <main>
      <header className="site-header">
        <a
          className="wordmark"
          href="#inicio"
          aria-label="Portal Financiero, inicio"
        >
          <span className="wordmark-mark" aria-hidden="true">
            PF
          </span>
          <span>Portal Financiero</span>
        </a>

        <nav className="site-nav" aria-label="Navegación principal">
          <a href="#herramientas">Herramientas</a>
          <a href="#datos">Datos</a>
          <a href="#metodo">Método</a>
        </nav>

        <div className="mode-indicator">
          <span className="mode-signal" aria-hidden="true" />
          Modo {health.mode}
        </div>
      </header>

      <div className="portal-frame" id="inicio">
        <aside className="measure-rail" aria-label="Referencia del portal">
          <div className="measure-scale" aria-hidden="true">
            <span>00</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
          <p>POINT-IN-TIME</p>
          <p>ES-AR / OWNER</p>
        </aside>

        <div className="portal-content">
          <section className="opening" aria-labelledby="portal-title">
            <div className="opening-copy">
              <h1 id="portal-title">
                Decidir mejor empieza por saber de dónde sale cada número.
              </h1>
              <p>
                Un espacio personal para investigar empresas, construir
                valuaciones y leer Argentina con datos fechados, cálculos
                reproducibles y supuestos a la vista.
              </p>
            </div>

            <div
              className="analysis-entry"
              aria-labelledby="analysis-entry-title"
            >
              <div className="entry-heading">
                <h2 id="analysis-entry-title">¿Qué querés analizar?</h2>
                <span>Se habilita en Fase 1</span>
              </div>
              <label htmlFor="global-analysis">Empresa, ticker o CEDEAR</label>
              <div className="search-shell">
                <input
                  id="global-analysis"
                  type="search"
                  placeholder="Ej. MercadoLibre, MELI o MELI.BA"
                  disabled
                />
                <span aria-hidden="true">Enter</span>
              </div>
              <p className="entry-note">
                La búsqueda se activará cuando exista un universo auditable. Hoy
                no se muestran resultados simulados como si fueran reales.
              </p>
            </div>
          </section>

          <section
            className="tools-section"
            id="herramientas"
            aria-labelledby="tools-title"
          >
            <div className="section-heading">
              <h2 id="tools-title">Una entrada distinta para cada decisión.</h2>
              <p>
                El lenguaje visual es común; la superficie cambia según la
                tarea.
              </p>
            </div>

            <div className="tool-register">
              {tools.map((tool) => (
                <article className="tool-row" key={tool.area}>
                  <div className="tool-meta">
                    <span>{tool.phase}</span>
                    <strong>{tool.area}</strong>
                  </div>
                  <div className="tool-copy">
                    <h3>{tool.question}</h3>
                    <p>{tool.description}</p>
                  </div>
                  <div className="tool-output">
                    <span>Formato</span>
                    <strong>{tool.output}</strong>
                  </div>
                  <span className="planned-state">Planificado</span>
                </article>
              ))}
            </div>
          </section>

          <section
            className="data-section"
            id="datos"
            aria-labelledby="data-title"
          >
            <div className="section-heading data-heading">
              <div>
                <h2 id="data-title">Estado real de la base.</h2>
                <p>La configuración se informa sin revelar valores secretos.</p>
              </div>
              <dl className="health-summary">
                <div>
                  <dt>Entorno</dt>
                  <dd>{health.mode}</dd>
                </div>
                <div>
                  <dt>Controles</dt>
                  <dd>{health.items.length}</dd>
                </div>
              </dl>
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
                    <span className={`status-mark status-${item.status}`}>
                      <span aria-hidden="true" />
                      {statusLabels[item.status]}
                    </span>
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

          <section
            className="method-section"
            id="metodo"
            aria-labelledby="method-title"
          >
            <div className="method-copy">
              <h2 id="method-title">La evidencia viaja con el resultado.</h2>
              <p>
                Fuente, fecha, unidad y transformación no viven en una nota al
                pie: forman parte de la lectura principal.
              </p>
            </div>
            <dl className="evidence-strip">
              <div>
                <dt>Fuente</dt>
                <dd>Origen verificable</dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>Disponible desde</dd>
              </div>
              <div>
                <dt>Unidad</dt>
                <dd>Moneda y escala</dd>
              </div>
              <div>
                <dt>Transformación</dt>
                <dd>Fórmula versionada</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <footer className="site-footer">
        <p>Información educativa, no asesoramiento financiero.</p>
        <p>Portal personal · código público · datos reales protegidos</p>
      </footer>
    </main>
  );
}
