import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readLiveAccount } from "@/modules/trading/application/live-account-service";
import { getLiveAccountDependencies } from "@/server/trading/live-account";
import { safeErrorSummary } from "@/server/trading/safe-error";

import type { LiveAccountResult } from "../actions";

import { LiveAccount } from "./live-account";

/**
 * La primera lectura de la cuenta, en el request (`F11-04`, `TM-04`: nada se
 * cachea). Después la sigue el componente cliente con la Server Action.
 */
export async function LiveAccountSection() {
  let initial: LiveAccountResult;
  try {
    initial = await readLiveAccount(getLiveAccountDependencies());
    if (initial.state === "failed") {
      console.warn("schwab account read failed", initial.code);
    }
  } catch (error) {
    console.error("schwab account read failed", safeErrorSummary(error));
    initial = { state: "unavailable" };
  }
  return <LiveAccount initial={initial} />;
}

export function LiveAccountSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader className="border-b">
        <CardTitle as="h2">Cuenta en vivo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Leyendo la cuenta en Schwab…
        </p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
