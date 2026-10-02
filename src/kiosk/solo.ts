"use client";

import { useEffect, useRef, useState } from "react";

export type Claim = { tabId: string; token: number };

/** The newer claim leads. A tie goes to the higher tab id, so one tab stays on. */
export function otherTabLeads(mine: Claim, other: Claim): boolean {
  if (other.tabId === mine.tabId) return false;
  return other.token > mine.token || (other.token === mine.token && other.tabId > mine.tabId);
}

export function useSoloKiosk(): boolean {
  const [leading, setLeading] = useState(true);
  const claim = useRef<Claim>({ tabId: "", token: 0 });

  useEffect(() => {
    const tabId = crypto.randomUUID();
    const channel = new BroadcastChannel("futureino-kiosk");
    const announce = () => {
      const next = { tabId, token: Date.now() };
      claim.current = next;
      setLeading(true);
      channel.postMessage({ type: "claim", tabId: next.tabId, token: next.token });
    };
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; tabId?: string; token?: number };
      if (data?.type !== "claim" || !data.tabId || typeof data.token !== "number") return;
      if (otherTabLeads(claim.current, { tabId: data.tabId, token: data.token })) setLeading(false);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") announce();
    };
    window.addEventListener("focus", announce);
    document.addEventListener("visibilitychange", onVisible);
    announce();
    return () => {
      channel.close();
      window.removeEventListener("focus", announce);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return leading;
}
