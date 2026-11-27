"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { refreshCalendarOnOpen } from "@/app/calendario/actions";

export function CalendarRefreshOnOpen() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void refreshCalendarOnOpen()
      .then((changed) => {
        if (active && changed) router.refresh();
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
