"use client";

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ScrollArea } from "@/components/ui/scroll-area";

const roots = new Map<string, Root>();

function waitForId(id: string, timeoutMs = 2000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      resolve(existing);
      return;
    }
    const started = Date.now();
    const tick = () => {
      const el = document.getElementById(id);
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`${id} did not mount`));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

type MountOpts = {
  hostId: string;
  listId: string;
  listClassName?: string;
  scrollClassName?: string;
  /** Element type for the scroll content root (default div). */
  listTag?: "div" | "pre";
};

/**
 * Mounts Radix ScrollArea into a host and creates a list element for legacy scripts.
 */
export async function mountLegacyListScroll({
  hostId,
  listId,
  listClassName = "",
  scrollClassName = "fw-vehicle-list-scroll",
  listTag = "div",
}: MountOpts): Promise<void> {
  const host = document.getElementById(hostId);
  if (!host) return;

  if (host.dataset.fwRadix === "1" && document.getElementById(listId)) return;

  const prev = roots.get(hostId);
  if (prev) {
    prev.unmount();
    roots.delete(hostId);
  }

  host.replaceChildren();
  host.dataset.fwRadix = "1";

  const root = createRoot(host);
  roots.set(hostId, root);
  const ListTag = listTag;

  flushSync(() => {
    root.render(
      <ScrollArea className={scrollClassName} type="always" scrollHideDelay={0}>
        <ListTag className={listClassName} id={listId} />
      </ScrollArea>,
    );
  });

  await waitForId(listId);
}

export function unmountLegacyListScroll(hostId: string): void {
  const root = roots.get(hostId);
  if (root) {
    root.unmount();
    roots.delete(hostId);
  }
  const host = document.getElementById(hostId);
  if (host) {
    delete host.dataset.fwRadix;
    host.replaceChildren();
  }
}

/** Dashboard watchlist */
export async function mountVehicleListScroll(): Promise<void> {
  await mountLegacyListScroll({
    hostId: "vehicle-list-host",
    listId: "vehicle-list",
    listClassName: "vehicle-list",
    scrollClassName: "fw-vehicle-list-scroll",
  });
}

export function unmountVehicleListScroll(): void {
  unmountLegacyListScroll("vehicle-list-host");
}

/** API proof vehicle inventory */
export async function mountApiProofInventoryScroll(): Promise<void> {
  await mountLegacyListScroll({
    hostId: "veh-list-host",
    listId: "veh-list",
    listClassName: "veh-list-body",
    scrollClassName: "fw-veh-inventory-scroll",
  });
}

export function unmountApiProofInventoryScroll(): void {
  unmountLegacyListScroll("veh-list-host");
}

/** API proof: inventory + endpoint directory + bus lookup raw JSON */
export async function mountApiProofScrolls(): Promise<void> {
  await Promise.all([
    mountLegacyListScroll({
      hostId: "endpoint-table-host",
      listId: "endpoint-table",
      listClassName: "endpoint-table",
      scrollClassName: "fw-endpoint-scroll",
    }),
    mountLegacyListScroll({
      hostId: "veh-list-host",
      listId: "veh-list",
      listClassName: "veh-list-body",
      scrollClassName: "fw-veh-inventory-scroll",
    }),
    mountLegacyListScroll({
      hostId: "lookup-raw-host",
      listId: "lookup-raw",
      listClassName: "lookup-raw",
      scrollClassName: "fw-lookup-raw-scroll",
      listTag: "pre",
    }),
  ]);
}

export function unmountApiProofScrolls(): void {
  unmountLegacyListScroll("endpoint-table-host");
  unmountLegacyListScroll("veh-list-host");
  unmountLegacyListScroll("lookup-raw-host");
}
