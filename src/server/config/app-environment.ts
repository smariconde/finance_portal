import "server-only";

import { connection } from "next/server";

import {
  getConfigHealth,
  type ConfigHealth,
} from "@/modules/configuration/domain/config-health";

/**
 * Único lector del modo efectivo desde una superficie
 * ([ADR 0005](../../../docs/architecture/adr/0005-request-time-runtime-boundary.md)).
 *
 * `connection()` declara que lo que sigue depende del runtime y no del build. Sin
 * él, Cache Components prerenderiza la ruta durante `next build` y hornea en el
 * HTML el modo de la máquina que compiló: el artefacto seguiría sirviendo la
 * corrida aunque el runtime que lo sirve esté trabado. El modo es una frontera de
 * seguridad (ADR 0004), así que se evalúa cuando llega el request.
 *
 * Es la única forma de preguntar por el modo a propósito. No existe una variante
 * síncrona: una segunda puerta sin `connection()` volvería a ser horneable, y el
 * error no se vería hasta leer el artefacto.
 */
export async function getRequestConfigHealth(): Promise<ConfigHealth> {
  await connection();

  return getConfigHealth(process.env);
}
