import { z } from "zod";

import {
  openRouterMaxPrice,
  type ModelRung,
} from "@/modules/ai/domain/model-ladder";
import type { AiTaskMessage } from "@/modules/ai/domain/ai-task";
import type { EgressFetch } from "@/modules/ingestion/application/egress-fetch";

/**
 * Adaptador del chat de OpenRouter
 * ([ADR 0033](../../../../docs/architecture/adr/0033-ai-layer-industry-resolution.md)).
 *
 * Arma un pedido cuyas garantías de privacidad están **en el código**: retención
 * cero (`zdr`), sin recolección de datos, sólo endpoints que soportan todos los
 * parámetros pedidos —el schema estricto incluido— y el precio máximo del
 * escalón. Ninguno se relaja por variable de entorno, y el adaptador no ve la
 * clave: la agrega la puerta de salida.
 */
export const OPENROUTER_SOURCE_ID = "openrouter";
export const OPENROUTER_CHAT_VERSION = "openrouter-chat-1.0.0";
export const OPENROUTER_CHAT_URL =
  "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterChatRequest = {
  readonly rung: ModelRung;
  readonly messages: readonly AiTaskMessage[];
  readonly maxOutputTokens: number;
  readonly output: {
    readonly name: string;
    readonly jsonSchema: Readonly<Record<string, unknown>>;
  };
};

/** Cuerpo exacto que sale. Exportado para que los tests afirmen sus garantías. */
export function buildOpenRouterBody(
  request: OpenRouterChatRequest,
): Record<string, unknown> {
  return {
    model: request.rung.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    max_tokens: request.maxOutputTokens,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: request.output.name,
        strict: true,
        schema: request.output.jsonSchema,
      },
    },
    provider: {
      zdr: true,
      data_collection: "deny",
      require_parameters: true,
      max_price: openRouterMaxPrice(request.rung),
    },
    usage: { include: true },
  };
}

export function encodeOpenRouterBody(
  request: OpenRouterChatRequest,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(buildOpenRouterBody(request)));
}

const envelopeSchema = z.object({
  model: z.string().min(1).max(128),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().min(0),
      completion_tokens: z.number().int().min(0),
      cost: z.number().min(0).optional(),
    })
    .optional(),
});

/**
 * Lo que volvió, clasificado. Un estado HTTP se traduce acá a un código cerrado;
 * el cuerpo de un error del proveedor no se conserva —puede repetir el pedido— y
 * sólo queda su estado.
 */
export type OpenRouterChatResult =
  | {
      readonly kind: "completed";
      readonly respondedModel: string;
      /** `null` si el modelo no devolvió texto. */
      readonly content: string | null;
      readonly finishReason: string | null;
      readonly promptTokens: number | null;
      readonly completionTokens: number | null;
      /** USD que informa el proveedor; `null` si no lo informó. */
      readonly costUsd: number | null;
    }
  /** `401`, `402`, `403`: la cuenta o la clave. Frena la corrida. */
  | { readonly kind: "unauthorized"; readonly status: number }
  /** `408`, `429`: el proveedor pide esperar. */
  | { readonly kind: "throttled"; readonly status: number }
  /** `5xx`: el proveedor no pudo. */
  | { readonly kind: "unavailable"; readonly status: number }
  /** Otro `4xx`: por ejemplo, ningún endpoint cumple ZDR y precio máximo. */
  | { readonly kind: "rejected"; readonly status: number }
  /** `2xx` cuyo cuerpo no es el sobre esperado. */
  | { readonly kind: "unreadable"; readonly status: number };

export function classifyOpenRouterResponse(
  status: number,
  body: Uint8Array,
): OpenRouterChatResult {
  if (status === 401 || status === 402 || status === 403) {
    return { kind: "unauthorized", status };
  }

  if (status === 408 || status === 429) {
    return { kind: "throttled", status };
  }

  if (status >= 500) {
    return { kind: "unavailable", status };
  }

  if (status < 200 || status >= 300) {
    return { kind: "rejected", status };
  }

  let json: unknown;

  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return { kind: "unreadable", status };
  }

  // OpenRouter puede contestar `200` con un objeto `error` cuando el proveedor
  // de abajo falla después de aceptar el pedido.
  if (typeof json === "object" && json !== null && "error" in json) {
    return { kind: "unavailable", status };
  }

  const parsed = envelopeSchema.safeParse(json);

  if (!parsed.success) {
    return { kind: "unreadable", status };
  }

  const [choice] = parsed.data.choices;

  return {
    kind: "completed",
    respondedModel: parsed.data.model,
    content: choice!.message.content,
    finishReason: choice!.finish_reason ?? null,
    promptTokens: parsed.data.usage?.prompt_tokens ?? null,
    completionTokens: parsed.data.usage?.completion_tokens ?? null,
    costUsd: parsed.data.usage?.cost ?? null,
  };
}

/** Una llamada al chat. Los errores de la puerta suben tal cual: los clasifica el llamador. */
export async function callOpenRouterChat(
  fetch: EgressFetch,
  body: Uint8Array,
): Promise<OpenRouterChatResult> {
  const response = await fetch({
    sourceId: OPENROUTER_SOURCE_ID,
    url: OPENROUTER_CHAT_URL,
    method: "POST",
    body,
    contentType: "application/json",
  });

  return classifyOpenRouterResponse(response.status, response.body);
}
