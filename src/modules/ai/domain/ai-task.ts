import { z } from "zod";

/**
 * Contrato de una tarea de la capa IA
 * ([ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md),
 * decisión 6).
 *
 * Una tarea declara su versión, la del prompt, el schema de salida —que viaja
 * al modelo como JSON Schema estricto y se vuelve a validar acá con Zod— y una
 * policy **determinista** que decide si la respuesta se acepta. La IA propone;
 * nada de lo que devuelve entra a un cálculo sin pasar por esa policy.
 */
export type AiTaskMessage = {
  readonly role: "system" | "user";
  readonly content: string;
};

export type AiTaskJudgement =
  | { readonly verdict: "accept" }
  /** La respuesta valida pero la policy no la admite: sube de escalón. */
  | { readonly verdict: "reject"; readonly code: string }
  /** El modelo dijo que no sabe: un escalón más capaz puede saber. */
  | { readonly verdict: "abstain"; readonly reason: string };

export type AiTask<Input, Output> = {
  readonly taskVersion: string;
  readonly promptVersion: string;
  /** Techo de tokens de salida: entra al pedido y al peor caso de la reserva. */
  readonly maxOutputTokens: number;
  readonly output: {
    /** Nombre del schema en `response_format`. */
    readonly name: string;
    /** Se manda tal cual, con `strict: true`. */
    readonly jsonSchema: Readonly<Record<string, unknown>>;
    /** Revalida lo que vuelve: un proveedor que ignora el schema no pasa. */
    readonly schema: z.ZodType<Output>;
  };
  readonly buildMessages: (input: Input) => readonly AiTaskMessage[];
  readonly judge: (output: Output, input: Input) => AiTaskJudgement;
};

/**
 * Tarea de humo (`ai-smoke-1.0.0`): devolver un token tal cual.
 *
 * Existe para medir la cadena entera —egress con credencial, enrutamiento con
 * ZDR, salida con schema estricto, costo informado, libro de gasto— sin mandar
 * nada que venga de una fuente. El token lo genera el comando y no significa
 * nada, así que ningún `aiTransfer` entra en juego.
 */
export type SmokeTaskInput = { readonly nonce: string };
export type SmokeTaskOutput = { readonly echo: string };

export const SMOKE_TASK: AiTask<SmokeTaskInput, SmokeTaskOutput> =
  Object.freeze({
    taskVersion: "ai-smoke-1.0.0",
    promptVersion: "ai-smoke-prompt-1.0.0",
    maxOutputTokens: 512,
    output: {
      name: "smoke_echo",
      jsonSchema: Object.freeze({
        type: "object",
        properties: { echo: { type: "string" } },
        required: ["echo"],
        additionalProperties: false,
      }),
      schema: z.object({ echo: z.string().max(128) }).strict(),
    },
    buildMessages: (input: SmokeTaskInput) => [
      {
        role: "system" as const,
        content:
          "You answer with a single JSON object that matches the given schema and nothing else.",
      },
      {
        role: "user" as const,
        content: `Return this token exactly, in the field "echo": ${input.nonce}`,
      },
    ],
    judge: (output: SmokeTaskOutput, input: SmokeTaskInput): AiTaskJudgement =>
      output.echo === input.nonce
        ? { verdict: "accept" }
        : { verdict: "reject", code: "echo_mismatch" },
  });
