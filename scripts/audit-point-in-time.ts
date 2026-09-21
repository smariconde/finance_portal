import { parseArgs } from "node:util";

import { runPointInTimeAudit } from "@/modules/observations/application/point-in-time-audit-reader";
import type {
  ClaimStatus,
  PointInTimeAuditReport,
} from "@/modules/observations/domain/point-in-time-audit";
import { getPointInTimeAuditReader } from "@/server/persistence/get-point-in-time-audit-reader";

/**
 * Verifica el contrato point-in-time sobre lo que la base ya publicó (`F2-07`).
 *
 * Es el gate de la Fase 2 vuelto comando. Hasta acá las afirmaciones del gate se
 * verificaron a mano y una sola vez —Apple antes y después de su 10-K/A, los
 * 17 ejercicios que ExxonMobil gana por el linaje—: el verificador las evalúa
 * sobre todas las cadenas publicadas y nombra la que deje de valer.
 *
 *   pnpm gate:point-in-time
 *   pnpm gate:point-in-time --json
 *
 * No escribe nada y no sale a la red. Termina en 1 si alguna afirmación falla o
 * quedó sin ejercitar: una afirmación que nunca se evaluó no es un verde.
 */
const { values } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
    "page-size": { type: "string" },
  },
});

const pageSize = values["page-size"]
  ? Number.parseInt(values["page-size"], 10)
  : undefined;

if (pageSize !== undefined && !Number.isInteger(pageSize)) {
  console.error("--page-size toma un entero.");
  process.exit(2);
}

function log(label: string, value: unknown): void {
  console.log(`${label.padEnd(34)} ${String(value)}`);
}

const MARK: Record<ClaimStatus, string> = {
  pass: "ok",
  fail: "FALLA",
  not_exercised: "sin ejercitar",
};

function render(report: PointInTimeAuditReport): void {
  log("regla", report.ruleVersion);
  log("cadenas", report.chains);
  log("revisiones", report.revisions);
  log("cadenas con restatement", report.restatedChains);
  log("filas sin documento citado", report.rowsWithoutSourceDocument);
  console.log("");

  for (const verdict of report.verdicts) {
    log(
      `${verdict.claim}`,
      `${MARK[verdict.status]} · ${verdict.checked} evaluadas, ${verdict.failed} fallidas`,
    );
  }

  if (report.findings.length > 0) {
    console.log("\nFallas:");

    for (const finding of report.findings) {
      console.log(
        `  ${finding.claim} · ${finding.detail} · sujeto ${finding.subjectId} · ${finding.metricId} ${finding.asOf} · observación ${finding.observationId}`,
      );
    }

    if (report.droppedFindings > 0) {
      log("  fallas no listadas", report.droppedFindings);
    }
  }

  console.log("");
  log("gate", report.passed ? "pasa" : "no pasa");
}

const report = await runPointInTimeAudit(getPointInTimeAuditReader(), {
  ...(pageSize === undefined ? {} : { pageSize }),
});

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  render(report);
}

process.exit(report.passed ? 0 : 1);
