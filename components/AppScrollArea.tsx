"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect } from "react";

/**
 * App-wide Radix scroll: owns the viewport scrollbar without collapsing page layout.
 */
export default function AppScrollArea({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("fw-radix-scroll");
    return () => document.documentElement.classList.remove("fw-radix-scroll");
  }, []);

  return (
    <ScrollArea className="fw-app-scroll" type="always" scrollHideDelay={0}>
      <div className="fw-app-scroll__content">{children}</div>
    </ScrollArea>
  );
}
