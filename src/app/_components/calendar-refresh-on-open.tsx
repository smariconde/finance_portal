"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  refreshArgentinaCalendarOnOpen,
  refreshCalendarOnOpen,
} from "@/app/calendario/actions";

export function CalendarRefreshOnOpen({
  argentina = false,
}: {
  readonly argentina?: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const refresh = argentina
      ? refreshArgentinaCalendarOnOpen
      : refreshCalendarOnOpen;
    void refresh()
      .then((changed) => {
        if (active && changed) router.refresh();
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [argentina, router]);

  return null;
}
