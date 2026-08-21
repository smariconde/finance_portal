import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";

export function getAppConfigHealth() {
  return getConfigHealth(process.env);
}
