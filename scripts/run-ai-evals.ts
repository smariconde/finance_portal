import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  DECLARED_EVAL_DOCUMENTS,
  DECLARED_EVAL_TARGETS,
  DECLARED_INDUSTRY_EVAL_BASES,
} from "@/modules/ai-evals/application/declared-eval-cases";
import { rejudgeAttempt } from "@/modules/ai-evals/application/rejudge-attempt";
import { runEvalCase } from "@/modules/ai-evals/application/run-eval-case";
import {
  DECLARED_INDUSTRY_GOLD,
  DECLARED_MIX_GOLD,
} from "@/modules/ai-evals/application/declared-eval-gold";
import {
  AI_EVAL_CASES_VERSION,
  type EvalCase,
  type EvalWebResult,
} from "@/modules/ai-evals/domain/eval-cases";
import { AI_EVAL_INJECTIONS_VERSION } from "@/modules/ai-evals/domain/eval-injections";
import {
  AI_EVAL_SCORING_VERSION,
  scoreAttempt,
  simulateLadder,
  summarize,
  type EvalAttempt,
  type EvalAttemptScore,
  type EvalSummary,
  type RungRef,
} from "@/modules/ai-evals/domain/eval-scoring";
import {
  EVAL_VARIANTS,
  findEvalVariant,
} from "@/modules/ai-evals/domain/eval-variants";
import { AI_EVAL_CORPUS_VERSION } from "@/modules/ai-evals/infrastructure/eval-corpus";
import { loadEvalCases } from "@/modules/ai-evals/infrastructure/load-eval-cases";
import {
  encodeOpenRouterBody,
  OPENROUTER_SOURCE_ID,
} from "@/modules/ai/application/openrouter-chat";
import {
  searchTavily,
  TAVILY_SOURCE_ID,
} from "@/modules/ai/application/tavily-search";
import { formatNanoUsd } from "@/modules/ai/domain/ai-spend";
import { assertAiTransferable } from "@/modules/ai/domain/ai-transfer";
import { worstCaseNanoUsd } from "@/modules/ai/domain/model-ladder";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import { syncDeclaredSourceRegistry } from "@/modules/ingestion/application/sync-source-registry";
import { describeSourceRefusal } from "@/modules/ingestion/domain/source-budget";
import { evaluateIngestionRights } from "@/modules/ingestion/domain/source-registry-entry";
import { DEMO_SOURCE_REGISTRY } from "@/modules/ingestion/infrastructure/demo-source-registry";
import { industryCandidates } from "@/modules/valuation/domain/industry-mapping";
import {
  INDUSTRY_RESOLUTION_TASK,
  industryWebQuery,
} from "@/modules/valuation/domain/industry-resolution-task";
import { OPERATIONS_MIX_TASK } from "@/modules/valuation/domain/operations-mix-task";
import { getAiLayer } from "@/server/ai/get-ai-layer";
import { getSourceEgressFetch } from "@/server/egress/get-source-egress-fetch";
import { getSourceBudgetStore } from "@/server/persistence/get-source-budget-store";
import { getSourceRegistryRepository } from "@/server/persistence/get-source-registry-repository";

/**
 * Evals en vivo de la capa IA (`F5-07`,
 * [ADR 0035](../docs/architecture/adr/0035-ai-layer-evals.md)).
 *
 *   pnpm ai:eval                                    # plan: lo pendiente, su peor caso y el gasto de hoy; no llama
 *   pnpm ai:eval --task mix --rung 1 --apply        # mide lo pendiente de ese escalón (gasta)
 *   pnpm ai:eval --variant ai-eval-low-effort-1.0.0 --task mix --rung 1 --apply
 *   pnpm ai:eval --summary                          # lee el reporte; no llama ni abre la base
 *   pnpm ai:eval --summary --rejudge                # lo grabado, juzgado por la policy vigente
 *   pnpm ai:eval --summary --ladder ai-model-ladder-1.0.0#2,ai-model-ladder-1.0.0#1
 *
 * Cada caso va a **un** escalón por vez. El reporte es un JSONL en `.ai-evals/`
 * —ignorado por git: tiene las salidas de los modelos— y se escribe a medida
 * que avanza, así que una corrida que frena un tope se retoma sin repetir lo
 * medido. Gasta contra los mismos topes que una tarea —USD 0,10 por caso, USD
 * 1,00 y 100 requests por día—, marcado `eval` en el libro.
 *
 * Los casos `web` (`F5-04`) necesitan una búsqueda real por empresa: la primera
 * corrida con `--apply` la hace (una request de Tavily cada una, de sus 10
 * diarias) y la guarda junto al reporte, así cada escalón mide la misma
 * evidencia. Ningún resultado de búsqueda entra al repositorio.
 */
const { values } = parseArgs({
  options: {
    task: { type: "string", multiple: true, default: [] },
    rung: { type: "string", multiple: true, default: [] },
    kind: { type: "string", multiple: true, default: [] },
    case: { type: "string", multiple: true, default: [] },
    variant: { type: "string", default: "ai-model-ladder-1.0.0" },
    limit: { type: "string" },
    report: { type: "string", default: ".ai-evals/attempts.jsonl" },
    ladder: { type: "string", multiple: true, default: [] },
    apply: { type: "boolean", default: false },
    summary: { type: "boolean", default: false },
    rejudge: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(26)} ${String(value)}`);
}

const WEB_CACHE = join(dirname(values.report), "web-results.json");

function readWebCache(): Map<string, readonly EvalWebResult[]> {
  if (!existsSync(WEB_CACHE)) return new Map();

  return new Map(
    Object.entries(
      JSON.parse(readFileSync(WEB_CACHE, "utf8")) as Record<
        string,
        EvalWebResult[]
      >,
    ),
  );
}

const webCache = readWebCache();
let { cases } = loadEvalCases(webCache);
let caseById = new Map(cases.map((evalCase) => [evalCase.caseId, evalCase]));

function readReport(): EvalAttempt[] {
  if (!existsSync(values.report)) return [];

  return readFileSync(values.report, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvalAttempt);
}

const measured = readReport();

// ------------------------------------------------------------------- resumen
if (values.summary) {
  const scores: EvalAttemptScore[] = measured
    .filter((attempt) => caseById.has(attempt.caseId))
    .map((attempt) => {
      const evalCase = caseById.get(attempt.caseId)!;
      // Con --rejudge, la policy vigente juzga otra vez lo grabado.
      return scoreAttempt(
        evalCase,
        values.rejudge ? rejudgeAttempt(evalCase, attempt) : attempt,
      );
    });
  const pct = (part: number, whole: number) =>
    whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
  const row = (label: string, s: EvalSummary) =>
    [
      label.padEnd(44),
      String(s.cases).padStart(3),
      pct(s.schemaValid, s.delivered).padStart(5),
      String(s.truncated).padStart(3),
      pct(s.accepted, s.cases).padStart(5),
      `${s.correct}/${s.withGold}`.padStart(6),
      String(s.policyRejected).padStart(3),
      String(s.abstained).padStart(3),
      `${s.followedInjection}/${s.withInjection}`.padStart(6),
      String(s.leaked).padStart(3),
      String(s.acceptedWithoutEvidence).padStart(3),
      String(s.citationInvalid).padStart(3),
      formatNanoUsd(s.countedNanoUsd).padStart(10),
      (s.cases === 0
        ? "—"
        : `${(s.latencyMs / s.cases / 1000).toFixed(1)}s`
      ).padStart(6),
    ].join(" ");
  const header = [
    "".padEnd(44),
    "n".padStart(3),
    "schm".padStart(5),
    "trc".padStart(3),
    "acep".padStart(5),
    "corr".padStart(6),
    "rej".padStart(3),
    "abs".padStart(3),
    "inyec".padStart(6),
    "lk".padStart(3),
    "awe".padStart(3),
    "cit".padStart(3),
    "USD".padStart(10),
    "lat".padStart(6),
  ].join(" ");
  const groups = new Map<string, EvalAttemptScore[]>();

  for (const score of scores) {
    const key = `${score.variantId} ${score.task} #${score.rung} ${score.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }

  const pending = [...DECLARED_INDUSTRY_GOLD, ...DECLARED_MIX_GOLD].filter(
    (gold) => gold.review !== "owner_reviewed",
  ).length;

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          versions: {
            corpus: AI_EVAL_CORPUS_VERSION,
            cases: AI_EVAL_CASES_VERSION,
            injections: AI_EVAL_INJECTIONS_VERSION,
            scoring: AI_EVAL_SCORING_VERSION,
          },
          goldPendingReview: pending,
          groups: Object.fromEntries(
            [...groups].map(([key, group]) => [key, summarize(group)]),
          ),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  log("puntuación", AI_EVAL_SCORING_VERSION);
  log(
    "veredictos",
    values.rejudge ? "policy vigente (--rejudge)" : "los grabados",
  );
  log("intentos en el reporte", measured.length);
  log(
    "gold sin revisar",
    pending === 0 ? "ninguno" : `${pending}: la corrección es provisoria`,
  );
  console.log(`\n${header}`);

  for (const [key, group] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(row(key, summarize(group)));
  }

  const ladders: (readonly RungRef[])[] = [
    ...EVAL_VARIANTS.map(
      (variant) =>
        variant.simulatedFrom ??
        variant.ladder.map((rung) => ({
          variantId: variant.variantId,
          rung: rung.rung,
        })),
    ),
    ...values.ladder.map((spec) =>
      spec.split(",").map((ref) => {
        const [variantId, rung] = ref.split("#");
        return { variantId: variantId!, rung: Number(rung) };
      }),
    ),
  ];

  console.log("\nEscaleras simuladas (la primera aceptada termina):");
  console.log(header);

  for (const ladder of ladders) {
    const label = ladder
      .map(
        (ref) => `${ref.variantId.replace(/-\d+\.\d+\.\d+$/u, "")}#${ref.rung}`,
      )
      .join(" → ");

    for (const task of ["industry", "mix"] as const) {
      for (const kind of [
        "baseline",
        "injection",
        "abstention",
        "web",
      ] as const) {
        const simulated = simulateLadder(
          scores.filter((s) => s.task === task && s.kind === kind),
          ladder,
        );

        if (simulated.outcomes.length === 0) continue;

        console.log(
          row(
            `${task} ${kind}${simulated.incomplete.length > 0 ? ` (−${simulated.incomplete.length})` : ""}`,
            summarize(simulated.outcomes),
          ),
        );
      }
    }

    console.log(`  ↑ ${label}`);
  }

  const hard = summarize(scores);
  console.log("");
  log("gate: inyección filtrada", hard.leaked);
  log(
    "gate: mix sin evidencia",
    scores.filter((s) => s.task === "mix" && s.acceptedWithoutEvidence).length,
  );
  process.exit(0);
}

// --------------------------------------------------------------------- plan
const variant = findEvalVariant(values.variant);

if (variant === null) {
  fail(
    `--variant necesita una de: ${EVAL_VARIANTS.map((v) => v.variantId).join(", ")}.`,
  );
}

const tasks =
  values.task.length > 0 ? values.task : (["industry", "mix"] as string[]);
const rungs =
  values.rung.length > 0
    ? values.rung.map(Number)
    : variant.ladder.map((rung) => rung.rung);

for (const rung of rungs) {
  if (!variant.ladder.some((candidate) => candidate.rung === rung)) {
    fail(`${variant.variantId} no tiene escalón ${rung}.`);
  }
}

const done = new Set(
  measured.map((a) => `${a.variantId}|${a.caseId}|${a.rung}`),
);
function planWork(): { evalCase: EvalCase; rung: number }[] {
  const selected = cases.filter(
    (evalCase) =>
      tasks.includes(evalCase.task) &&
      (values.kind.length === 0 || values.kind.includes(evalCase.kind)) &&
      (values.case.length === 0 ||
        values.case.some((prefix) => evalCase.caseId.startsWith(prefix))),
  );
  const pending = rungs.flatMap((rung) =>
    selected
      .filter(
        (evalCase) =>
          !done.has(`${variant!.variantId}|${evalCase.caseId}|${rung}`),
      )
      .map((evalCase) => ({ evalCase, rung })),
  );

  return values.limit === undefined
    ? pending
    : pending.slice(0, Number(values.limit));
}

let work = planWork();
const missingWeb =
  tasks.includes("industry") &&
  (values.kind.length === 0 || values.kind.includes("web"))
    ? DECLARED_EVAL_TARGETS.industryAbstentions.filter(
        (cik) => !webCache.has(cik),
      )
    : [];

function worstCase(evalCase: EvalCase, rung: number): number {
  const step = variant!.ladder.find((candidate) => candidate.rung === rung)!;
  const task =
    evalCase.task === "industry"
      ? INDUSTRY_RESOLUTION_TASK
      : OPERATIONS_MIX_TASK;
  const body = encodeOpenRouterBody({
    rung: step,
    messages:
      evalCase.task === "industry"
        ? INDUSTRY_RESOLUTION_TASK.buildMessages(evalCase.input)
        : OPERATIONS_MIX_TASK.buildMessages(evalCase.input),
    maxOutputTokens: task.maxOutputTokens,
    output: task.output,
  });

  return worstCaseNanoUsd(step, body.byteLength, task.maxOutputTokens);
}

const now = new Date().toISOString();
const layer = getAiLayer();
const day = await layer.spend.readDay(OPENROUTER_SOURCE_ID, now);

log("corpus", AI_EVAL_CORPUS_VERSION);
log("casos", `${AI_EVAL_CASES_VERSION} · ${AI_EVAL_INJECTIONS_VERSION}`);
log("variante", variant.variantId);
log("tareas · escalones", `${tasks.join(", ")} · ${rungs.join(", ")}`);
log("pendientes", work.length);
log(
  "búsquedas web pendientes",
  missingWeb.length === 0
    ? "ninguna"
    : `${missingWeb.length} (sus casos web se suman al buscarlas)`,
);
log(
  "peor caso de lo pendiente",
  `USD ${formatNanoUsd(work.reduce((sum, item) => sum + worstCase(item.evalCase, item.rung), 0))}`,
);
log(
  "gasto de hoy",
  `USD ${formatNanoUsd(day.countedNanoUsd)} de ${day.effectiveDailyLimitNanoUsd === null ? "—" : formatNanoUsd(day.effectiveDailyLimitNanoUsd)} · ${day.attempts} intentos`,
);
log("reporte", values.report);

if (!values.apply) {
  console.log(
    "\nDry run: no se llamó a ningún modelo. Usá --apply para gastar.",
  );
  process.exit(0);
}

if (work.length === 0 && missingWeb.length === 0) {
  console.log("\nNada pendiente.");
  process.exit(0);
}

// ------------------------------------------------------------------ derechos
const entry = DEMO_SOURCE_REGISTRY.find(
  (candidate) => candidate.sourceId === OPENROUTER_SOURCE_ID,
);
const rights =
  entry === undefined
    ? null
    : evaluateIngestionRights(entry, {
        storesRawPayload: false,
        storesNormalizedValues: false,
        publicDisplay: false,
      });

if (rights === null || !rights.allowed) {
  fail(
    `${OPENROUTER_SOURCE_ID} no está aprobada: ${rights?.blockedBy.join(", ") ?? "sin fila"}.`,
  );
}

// La evidencia es de la SEC: tiene que poder viajar a un modelo.
assertAiTransferable(["sec-edgar"], DEMO_SOURCE_REGISTRY);

const budget = await checkSourceBudget(
  getSourceBudgetStore(),
  OPENROUTER_SOURCE_ID,
  1,
  now,
);

if (budget.status !== "allowed") {
  fail(describeSourceRefusal(OPENROUTER_SOURCE_ID, budget));
}

await syncDeclaredSourceRegistry(
  DEMO_SOURCE_REGISTRY,
  getSourceRegistryRepository(),
);

// --------------------------------------------------------- búsquedas web
if (missingWeb.length > 0) {
  const webVerdict = await checkSourceBudget(
    getSourceBudgetStore(),
    TAVILY_SOURCE_ID,
    missingWeb.length,
    now,
  );

  if (webVerdict.status !== "allowed") {
    fail(describeSourceRefusal(TAVILY_SOURCE_ID, webVerdict));
  }

  const webFetch = getSourceEgressFetch({
    minIntervalMs: 1000,
    maxRequests: missingWeb.length,
  });

  for (const cik of missingWeb) {
    const document = DECLARED_EVAL_DOCUMENTS.find((d) => d.cik === cik)!;
    const base = DECLARED_INDUSTRY_EVAL_BASES.find((b) => b.cik === cik)!;
    const query = industryWebQuery(
      document.companyName,
      industryCandidates(base.sic.code) ?? [],
    );
    const result = await searchTavily(webFetch, query);

    if (result.kind !== "completed") {
      fail(
        `Tavily respondió ${result.kind} (${result.status}) para ${document.ticker}.`,
      );
    }

    webCache.set(
      cik,
      result.results.map((item) => ({ url: item.url, excerpt: item.excerpt })),
    );
    console.log(
      `  búsqueda ${document.ticker.padEnd(6)} ${result.results.length} resultados · «${query}»`,
    );
  }

  mkdirSync(dirname(WEB_CACHE), { recursive: true });
  writeFileSync(
    WEB_CACHE,
    `${JSON.stringify(Object.fromEntries(webCache), null, 2)}\n`,
    "utf8",
  );
  ({ cases } = loadEvalCases(webCache));
  caseById = new Map(cases.map((evalCase) => [evalCase.caseId, evalCase]));
  work = planWork();
}

// ------------------------------------------------------------------ medición
mkdirSync(dirname(values.report), { recursive: true });

const run = layer.runDependencies();
let spent = 0;

console.log("");

for (const { evalCase, rung } of work) {
  const result = await runEvalCase(evalCase, variant, rung, run);

  if (result.status === "stopped") {
    console.log(
      `\nFrenado en ${evalCase.caseId} #${rung}: ${result.code}${result.detail ? ` (${result.detail})` : ""}. Lo medido quedó en el reporte; se retoma con el mismo comando.`,
    );
    break;
  }

  const { attempt } = result;
  const score = scoreAttempt(evalCase, attempt);

  appendFileSync(values.report, `${JSON.stringify(attempt)}\n`, "utf8");
  spent += attempt.countedNanoUsd;

  console.log(
    [
      `  ${evalCase.caseId.padEnd(44)} #${rung}`,
      `${attempt.outcome}${attempt.detail ? `(${attempt.detail})` : ""}`.padEnd(
        44,
      ),
      score.correct === null ? "    " : score.correct ? "ok  " : "mal ",
      score.followedInjection === true ? "obedeció" : "",
      score.leaked ? "FILTRÓ" : "",
      score.acceptedWithoutEvidence ? "SIN-EVIDENCIA" : "",
      `${attempt.completionTokens ?? "—"} tok`,
      `USD ${formatNanoUsd(attempt.countedNanoUsd)}`,
    ]
      .filter((part) => part.length > 0)
      .join(" "),
  );
}

console.log("");
log("gastado en esta corrida", `USD ${formatNanoUsd(spent)}`);
process.exit(0);
