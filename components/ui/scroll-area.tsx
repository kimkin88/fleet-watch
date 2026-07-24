"use client";

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentPropsWithoutRef, ComponentRef, Ref } from "react";
import { forwardRef } from "react";

import "./scroll-area.css";

type RootProps = ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>;

export const ScrollArea = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.Root>,
  RootProps & {
    viewportClassName?: string;
    viewportStyle?: React.CSSProperties;
    viewportRef?: Ref<HTMLDivElement>;
  }
>(function ScrollArea(
  { className, children, viewportClassName, viewportStyle, viewportRef, ...props },
  ref,
) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={["fw-scroll-area", className].filter(Boolean).join(" ")}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={["fw-scroll-area__viewport", viewportClassName].filter(Boolean).join(" ")}
        style={viewportStyle}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner className="fw-scroll-area__corner" />
    </ScrollAreaPrimitive.Root>
  );
});

export const ScrollBar = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(function ScrollBar({ className, orientation = "vertical", ...props }, ref) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={["fw-scroll-area__scrollbar", `fw-scroll-area__scrollbar--${orientation}`, className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="fw-scroll-area__thumb" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});
