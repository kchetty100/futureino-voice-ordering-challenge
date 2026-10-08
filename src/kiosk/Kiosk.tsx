"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getItem,
  itemsForMachine,
  MACHINES,
  type CatalogItem,
  type MachineId,
  type Temperature,
  boundMachineId,
} from "../catalog/index";
import { parseNavIntent, type UiCommand } from "../agent/nav";
import { isClearYes, wantsChange, wantsNoMore } from "../agent/tools";
import { APP_LANGUAGES, isAppLanguage, t, ui as screenText, type AppLanguage } from "../i18n";
import { BLIND_BEFORE_COUNTDOWN_MS, formatLeaveClock, LEAVE_COUNTDOWN_MS, leaveSecondsLeft } from "./leave";
import { PLAYBACK_TAIL_MS, utteranceReady, VOICE_HOLD_MS } from "./voice";
import { useSoloKiosk } from "./solo";
import { type OrderInput, type OrderSession, type ReadBack } from "../order/engine";
import styles from "./kiosk.module.css";

type Screen = "attract" | "menu" | "review" | "pay";
type Picker = { productId: string; lineId?: string };

/** The machine's greeting: what it makes and, for drinks, the temperatures. */
function welcomeKey(machineId: MachineId): "welcome_coffee" | "welcome_snacks" {
  return machineId === "coffee" ? "welcome_coffee" : "welcome_snacks";
}

function retargetSay(current: string | null, next: AppLanguage): string | null {
  if (!current) return current;
  for (const key of ["welcome_choose", "welcome_coffee", "welcome_snacks"] as const) {
    if (APP_LANGUAGES.some((language) => t(language, key) === current)) return t(next, key);
  }
  if (APP_LANGUAGES.some((language) => t(language, "didnt_catch") === current)) {
    return t(next, "didnt_catch");
  }
  return current;
}

const LANGUAGES: { id: AppLanguage; code: string; label: string }[] = [
  { id: "en", code: "EN", label: "English" },
  { id: "es", code: "ES", label: "Español" },
  { id: "fr", code: "FR", label: "Français" },
  { id: "he", code: "HE", label: "עברית" },
  { id: "af", code: "AF", label: "Afrikaans" },
];

const TEMP_IDS: Temperature[] = ["hot", "iced", "room"];

const BOUND_MACHINE: MachineId | null = boundMachineId();
const MACHINE_BOUND = BOUND_MACHINE != null;

/** Bound unit catalog, or coffee fallback when the demo picker is active. */
function defaultMachineId(): MachineId {
  return BOUND_MACHINE ?? "coffee";
}

const DEFAULT_MACHINE: MachineId = defaultMachineId();

/** Desktop / laptop kiosk (matches the CSS 840px breakpoint): split Menu with a side panel. */
const WIDE_QUERY = "(min-width: 840px)";

function useWide(): boolean {
  // Menu only mounts client-side (after a tap), so read the width on first paint: no phone-layout flash.
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return wide;
}

function tempWord(language: AppLanguage, id: Temperature): string {
  return screenText(language, id);
}

function tempHint(language: AppLanguage, id: Temperature): string {
  if (id === "hot") return screenText(language, "hot_hint");
  if (id === "iced") return screenText(language, "iced_hint");
  return screenText(language, "room_hint");
}

function isNetworkNotice(notice: string | null): boolean {
  if (!notice) return false;
  return APP_LANGUAGES.some((lang) => notice === screenText(lang, "network"));
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

type ServerState = {
  session: OrderSession | null;
  readBack: ReadBack | null;
  say: string | null;
  notice: string | null;
  spotlightIds: string[];
  ui?: UiCommand | null;
  transcript?: string | null;
  speakTicket?: string | null;
};

export function Kiosk() {
  const [screen, setScreen] = useState<Screen>("attract");
  const screenRef = useRef<Screen>("attract");
  const sheetBack = useRef(false);
  function show(next: Screen) {
    screenRef.current = next;
    setScreen(next);
  }
  const [session, setSession] = useState<OrderSession | null>(null);
  const [readBack, setReadBack] = useState<ReadBack | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [say, setSay] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voiceSample, setVoiceSample] = useState<VoiceSample | null>(null);
  const [spotlightIds, setSpotlightIds] = useState<string[]>([]);
  const [language, setLanguage] = useState<AppLanguage>("en");
  const [languagePinned, setLanguagePinned] = useState(false);
  const languageRef = useRef({ language: "en" as AppLanguage, pinned: false });
  languageRef.current = { language, pinned: languagePinned };
  const [menu, setMenu] = useState<MachineId | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  /** True from Attract tap until session POST resolves — Menu may paint with session null. */
  const [opening, setOpening] = useState(false);
  const [uiPulse, setUiPulse] = useState<{ command: UiCommand; id: number } | null>(null);
  const requestSeq = useRef(0);
  const liveSessionId = useRef<string | null>(null);
  const seenActivity = useRef(0);
  const seenCart = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const meterCtx = useRef<AudioContext | null>(null);
  const voice = useRef<AudioBufferSourceNode | null>(null);
  const speakingNow = useRef(false);
  /** Bumped on every stop so an in-flight welcome line never plays over newer speech. */
  const welcomeSeq = useRef(0);
  /** Welcome audio per language, so Attract tap plays at once without waiting on TTS. */
  const welcomeAudio = useRef(new Map<string, ArrayBuffer>());
  /** One in-flight welcome TTS prefetch per language key. */
  const welcomePrefetch = useRef(new Map<string, Promise<ArrayBuffer | null>>());
  /** Speak TTS cache (read-back + ready_to_pay): `${cartVersion}|${language}|${say}` → audio bytes. */
  const readBackAudio = useRef(new Map<string, ArrayBuffer>());
  /** In-flight warm keyed by `${cartVersion}|${language}` (say unknown until warm returns). */
  const readBackPrefetch = useRef(new Map<string, Promise<ArrayBuffer | null>>());
  /** In-flight ready_to_pay warm keyed by `${cartVersion}|${language}`. */
  const readyPayPrefetch = useRef(new Map<string, Promise<ArrayBuffer | null>>());
  /** Last warmed ready_to_pay say per cart+language (shared speak cache is say-keyed). */
  const readyPaySay = useRef(new Map<string, string>());
  const leading = useSoloKiosk();
  const soloRef = useRef(true);
  soloRef.current = leading;
  const stopTalkRef = useRef<() => void>(() => {});

  function audioContext(): AudioContext {
    if (!audioCtx.current) audioCtx.current = new AudioContext();
    return audioCtx.current;
  }

  function stopPlayback() {
    welcomeSeq.current += 1;
    speakingNow.current = false;
    const source = voice.current;
    voice.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    setSpeaking(false);
  }

  function armAudio(): AudioContext {
    const playback = audioContext();
    void playback.resume();
    if (!meterCtx.current) meterCtx.current = new AudioContext();
    void meterCtx.current.resume();
    return meterCtx.current;
  }

  function beginSpeech(state: ServerState, mine: number) {
    const ticket = state.speakTicket?.trim();
    const line = (state.say ?? "").trim();
    if (!ticket || !line || !soloRef.current) {
      stopPlayback();
      return;
    }
    stopPlayback();
    // Flip Talk to speaking immediately (cache hit or TTS fetch) — same as welcome.
    speakingNow.current = true;
    setSpeaking(true);
    const lang: AppLanguage = isAppLanguage(state.session?.preferredLanguage)
      ? state.session!.preferredLanguage
      : languageRef.current.language;
    const cv = state.session?.cartVersion;
    if (cv != null) {
      const cached = readBackAudio.current.get(readBackCacheKey(cv, lang, line));
      if (cached) {
        void playBytes(cached, () => mine === requestSeq.current && soloRef.current);
        return;
      }
    }
    void speakLine(line, ticket, mine);
  }

  async function speakLine(say: string, ticket: string, mine: number) {
    try {
      const response = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ say, ticket }),
      });
      if (!response.ok || mine !== requestSeq.current || !soloRef.current) {
        speakingNow.current = false;
        setSpeaking(false);
        return;
      }
      const bytes = await response.arrayBuffer();
      if (mine !== requestSeq.current || !soloRef.current) {
        speakingNow.current = false;
        setSpeaking(false);
        return;
      }
      await playBytes(bytes);
    } catch {
      speakingNow.current = false;
      setSpeaking(false);
    }
  }

  async function playBytes(bytes: ArrayBuffer, still: () => boolean = () => soloRef.current) {
    if (!still()) return;
    try {
      const context = audioContext();
      await context.resume();
      if (!still()) {
        stopPlayback();
        return;
      }
      const buffer = await context.decodeAudioData(bytes.slice(0));
      if (!still()) {
        stopPlayback();
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (voice.current === source) {
          voice.current = null;
          speakingNow.current = false;
          setSpeaking(false);
        }
      };
      voice.current = source;
      source.start();
    } catch {
      speakingNow.current = false;
      setSpeaking(false);
    }
  }

  function welcomeCacheKey(language: AppLanguage, pinned: boolean, machineId: MachineId): string {
    return `${machineId}|${pinned ? language : "en"}`;
  }

  /**
   * Fetch welcome TTS into welcomeAudio (no playback). Dedupes in-flight work per language.
   * Completing after leave Attract still caches — next tap / visit can use it.
   */
  function loadWelcomeAudio(language: AppLanguage, pinned: boolean, machineId: MachineId): Promise<ArrayBuffer | null> {
    const key = welcomeCacheKey(language, pinned, machineId);
    const cached = welcomeAudio.current.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = welcomePrefetch.current.get(key);
    if (pending) return pending;
    const job = (async (): Promise<ArrayBuffer | null> => {
      try {
        const arrive = await fetch("/api/arrive", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intent: "welcome", machine: machineId, ...(pinned ? { language } : {}) }),
        });
        if (!arrive.ok) return null;
        const state = (await arrive.json()) as ServerState;
        const ticket = state.speakTicket?.trim();
        const line = (state.say ?? "").trim();
        if (!ticket || !line) return null;
        const spoken = await fetch("/api/speak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ say: line, ticket }),
        });
        if (!spoken.ok) return null;
        const bytes = await spoken.arrayBuffer();
        welcomeAudio.current.set(key, bytes);
        return bytes;
      } catch {
        return null;
      } finally {
        welcomePrefetch.current.delete(key);
      }
    })();
    welcomePrefetch.current.set(key, job);
    return job;
  }

  /** Warm welcomeAudio while Attract is idle so the first machine tap plays from cache. */
  function prefetchWelcome(language: AppLanguage, pinned: boolean) {
    if (!soloRef.current) return;
    if (screenRef.current !== "attract") return;
    // Bound unit: its own greeting. Demo: both machines, so either card plays from cache.
    const machines: MachineId[] = MACHINE_BOUND ? [DEFAULT_MACHINE] : ["coffee", "snacks"];
    for (const machineId of machines) {
      const key = welcomeCacheKey(language, pinned, machineId);
      if (welcomeAudio.current.has(key) || welcomePrefetch.current.has(key)) continue;
      void loadWelcomeAudio(language, pinned, machineId);
    }
  }

  function readBackCacheKey(cartVersion: number, language: AppLanguage, say: string): string {
    return `${cartVersion}|${language}|${say}`;
  }

  function readBackPrefetchKey(cartVersion: number, language: AppLanguage): string {
    return `${cartVersion}|${language}`;
  }

  function cartReadyForReadBack(next: OrderSession): boolean {
    if (next.lines.length === 0) return false;
    return !next.lines.some(
      (line) => getItem(line.productId)?.requiresTemperature === true && line.temperature === undefined,
    );
  }

  function invalidateReadBackCache(cartVersion: number) {
    for (const key of [...readBackAudio.current.keys()]) {
      if (!key.startsWith(`${cartVersion}|`)) readBackAudio.current.delete(key);
    }
    for (const key of [...readBackPrefetch.current.keys()]) {
      if (!key.startsWith(`${cartVersion}|`)) readBackPrefetch.current.delete(key);
    }
    for (const key of [...readyPayPrefetch.current.keys()]) {
      if (!key.startsWith(`${cartVersion}|`)) readyPayPrefetch.current.delete(key);
    }
    for (const key of [...readyPaySay.current.keys()]) {
      if (!key.startsWith(`${cartVersion}|`)) readyPaySay.current.delete(key);
    }
  }

  /**
   * Fetch read-back TTS into readBackAudio (no playback). Dedupes in-flight work per cart+language.
   * Does not change session phase — warm-readback only builds the spoken line.
   */
  function loadReadBackAudio(
    sessionId: string,
    cartVersion: number,
    language: AppLanguage,
  ): Promise<ArrayBuffer | null> {
    const prefetchKey = readBackPrefetchKey(cartVersion, language);
    const readySay = readyPaySay.current.get(prefetchKey);
    for (const [key, bytes] of readBackAudio.current) {
      if (!key.startsWith(`${prefetchKey}|`)) continue;
      // Shared speak cache may also hold ready_to_pay for this cart — skip that say.
      if (readySay && key === readBackCacheKey(cartVersion, language, readySay)) continue;
      return Promise.resolve(bytes);
    }
    const pending = readBackPrefetch.current.get(prefetchKey);
    if (pending) return pending;
    const job = (async (): Promise<ArrayBuffer | null> => {
      try {
        const warm = await fetch(`/api/sessions/${sessionId}/warm-readback`, { method: "POST" });
        if (!warm.ok) return null;
        const data = (await warm.json()) as {
          say?: string;
          speakTicket?: string | null;
          cartVersion?: number;
        };
        const ticket = data.speakTicket?.trim();
        const line = (data.say ?? "").trim();
        const cv = data.cartVersion ?? cartVersion;
        if (!ticket || !line || cv !== cartVersion) return null;
        const spoken = await fetch("/api/speak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ say: line, ticket }),
        });
        if (!spoken.ok) return null;
        const bytes = await spoken.arrayBuffer();
        invalidateReadBackCache(cv);
        readBackAudio.current.set(readBackCacheKey(cv, language, line), bytes);
        return bytes;
      } catch {
        return null;
      } finally {
        readBackPrefetch.current.delete(prefetchKey);
      }
    })();
    readBackPrefetch.current.set(prefetchKey, job);
    return job;
  }

  /** Warm read-back TTS while cart is complete so Review / checkout plays from cache. */
  function prefetchReadBack(sessionId: string, cartVersion: number, language: AppLanguage) {
    if (!soloRef.current) return;
    if (opening) return;
    if (screenRef.current === "pay" || screenRef.current === "attract") return;
    const prefetchKey = readBackPrefetchKey(cartVersion, language);
    const readySay = readyPaySay.current.get(prefetchKey);
    const hasReadBack = [...readBackAudio.current.keys()].some((key) => {
      if (!key.startsWith(`${prefetchKey}|`)) return false;
      if (readySay && key === readBackCacheKey(cartVersion, language, readySay)) return false;
      return true;
    });
    if (hasReadBack) return;
    if (readBackPrefetch.current.has(prefetchKey)) return;
    void loadReadBackAudio(sessionId, cartVersion, language);
  }

  /**
   * Fetch ready_to_pay TTS into the shared speak cache (no playback, no phase change).
   * Dedupes in-flight work per cart+language; beginSpeech cache-hits by say.
   */
  function loadReadyPayAudio(
    sessionId: string,
    cartVersion: number,
    language: AppLanguage,
  ): Promise<ArrayBuffer | null> {
    const prefetchKey = readBackPrefetchKey(cartVersion, language);
    const knownSay = readyPaySay.current.get(prefetchKey);
    if (knownSay) {
      const cached = readBackAudio.current.get(readBackCacheKey(cartVersion, language, knownSay));
      if (cached) return Promise.resolve(cached);
    }
    const pending = readyPayPrefetch.current.get(prefetchKey);
    if (pending) return pending;
    const job = (async (): Promise<ArrayBuffer | null> => {
      try {
        const warm = await fetch(`/api/sessions/${sessionId}/warm-ready`, { method: "POST" });
        if (!warm.ok) return null;
        const data = (await warm.json()) as {
          say?: string;
          speakTicket?: string | null;
          cartVersion?: number;
        };
        const ticket = data.speakTicket?.trim();
        const line = (data.say ?? "").trim();
        const cv = data.cartVersion ?? cartVersion;
        if (!ticket || !line || cv !== cartVersion) return null;
        readyPaySay.current.set(prefetchKey, line);
        const existing = readBackAudio.current.get(readBackCacheKey(cv, language, line));
        if (existing) return existing;
        const spoken = await fetch("/api/speak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ say: line, ticket }),
        });
        if (!spoken.ok) return null;
        const bytes = await spoken.arrayBuffer();
        invalidateReadBackCache(cv);
        readBackAudio.current.set(readBackCacheKey(cv, language, line), bytes);
        readyPaySay.current.set(prefetchKey, line);
        return bytes;
      } catch {
        return null;
      } finally {
        readyPayPrefetch.current.delete(prefetchKey);
      }
    })();
    readyPayPrefetch.current.set(prefetchKey, job);
    return job;
  }

  /** Warm ready_to_pay TTS while sitting on Review so Confirm / yes plays from cache. */
  function prefetchReadyPay(sessionId: string, cartVersion: number, language: AppLanguage) {
    if (!soloRef.current) return;
    if (opening) return;
    if (screenRef.current !== "review") return;
    const prefetchKey = readBackPrefetchKey(cartVersion, language);
    const knownSay = readyPaySay.current.get(prefetchKey);
    if (knownSay && readBackAudio.current.has(readBackCacheKey(cartVersion, language, knownSay))) return;
    if (readyPayPrefetch.current.has(prefetchKey)) return;
    void loadReadyPayAudio(sessionId, cartVersion, language);
  }

  /** Paint Pay immediately when confirm is certain client-side (tap / clear yes). */
  function paintPayOptimistic() {
    if (screenRef.current !== "review") return;
    setShowMenu(false);
    show("pay");
  }

  /**
   * Attract tap welcome. Runs beside the session POST so the voice starts with the menu,
   * not after the session round trip. Cache / in-flight prefetch plays immediately; else generates.
   * Any later speech or stop cancels playback.
   */
  function speakWelcome(language: AppLanguage, pinned: boolean, machineId: MachineId) {
    stopPlayback();
    if (!soloRef.current) return;
    const mine = welcomeSeq.current;
    const still = () => mine === welcomeSeq.current && soloRef.current;
    const quiet = () => {
      if (!still()) return;
      speakingNow.current = false;
      setSpeaking(false);
    };
    speakingNow.current = true;
    setSpeaking(true);
    void (async () => {
      try {
        const bytes = await loadWelcomeAudio(language, pinned, machineId);
        if (!bytes || !still()) return quiet();
        await playBytes(bytes, still);
      } catch {
        quiet();
      }
    })();
  }

  async function post(
    url: string,
    body: unknown,
    opts: { keepVoice?: boolean } = {},
  ): Promise<ServerState | null> {
    const mine = ++requestSeq.current;
    const isAudio = body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: isAudio ? undefined : { "content-type": "application/json" },
        body: isAudio ? body : JSON.stringify(body),
      });
    } catch {
      if (mine === requestSeq.current) {
        setNotice(screenText(languageRef.current.language, "network"));
      }
      return null;
    }
    if (!response.ok) {
      let message = screenText(languageRef.current.language, "network");
      try {
        const payload = (await response.json()) as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // The body was not JSON. Keep the connection message.
      }
      if (mine === requestSeq.current) setNotice(message);
      return null;
    }
    const state = (await response.json()) as ServerState;
    if (mine !== requestSeq.current) return state;
    const transcript = typeof state.transcript === "string" ? state.transcript.trim() : "";
    const heardNav = parseNavIntent(transcript);
    const ui = state.ui ?? (heardNav?.kind === "ui" ? heardNav.ui : null);
    const goingBack = ui === "go_back";
    if (screenRef.current === "attract") {
      setHeard(transcript || null);
      setNotice(null);
      setSpotlightIds([]);
      setReadBack(null);
      sheetBack.current = false;
      if (goingBack) {
        setSay(screenText(languageRef.current.language, "home_screen"));
        return state;
      }
      const live = session && session.phase !== "abandoned" ? session : null;
      if (live && (heardNav || ui)) {
        show("menu");
        setShowMenu(true);
        void post(`/api/sessions/${live.id}/message`, {
          text: transcript,
          ...(languageRef.current.pinned ? { language: languageRef.current.language } : {}),
        });
        return state;
      }
      if (heardNav?.kind === "clear_cart" || ui === "open_cart") {
        setSay(t(languageRef.current.language, "cart_empty"));
        return state;
      }
      if (ui === "scroll_up" || ui === "scroll_down") {
        setSay(t(languageRef.current.language, "open_menu_first"));
        return state;
      }
      if (!state.session) {
        setSay(state.say ?? t(languageRef.current.language, "didnt_catch"));
        if (transcript) beginSpeech(state, mine);
        return state;
      }
    }
    const nextSession = state.session;
    if (nextSession && !isNewerSession(nextSession)) return state;
    const movedBack = goingBack ? retreat() : false;
    if (!goingBack) sheetBack.current = false;
    if (!goingBack) {
      if (ui && nextSession) {
        setShowMenu(true);
        show("menu");
        setUiPulse((prev) => ({ command: ui, id: (prev?.id ?? 0) + 1 }));
      } else if (state.readBack && nextSession?.phase === "ready_to_pay") {
        setShowMenu(false);
        show("pay");
      } else if (state.readBack && nextSession?.phase === "awaiting_confirmation") {
        setShowMenu(false);
        show("review");
      } else if (nextSession && (nextSession.phase === "browsing" || nextSession.phase === "drafting")) {
        show("menu");
      }
    }
    if (nextSession) {
      liveSessionId.current = nextSession.id;
      setSession(nextSession);
      if (nextSession.languageSet && isAppLanguage(nextSession.preferredLanguage)) {
        languageRef.current = { language: nextSession.preferredLanguage, pinned: true };
        setLanguage(nextSession.preferredLanguage);
        setLanguagePinned(true);
      }
    }
    if (!goingBack) setReadBack(state.readBack);
    setNotice(state.notice);
    // keepVoice: a silent reply (session open) must not blank the line on screen or cut the welcome voice.
    if (!opts.keepVoice || state.say) {
      setSay(goingBack && !movedBack ? screenText(languageRef.current.language, "home_screen") : state.say);
    }
    // "No thanks" after an offer keeps the offer lit, so they can still pick from it.
    const keepLit = state.spotlightIds.length === 0 && APP_LANGUAGES.some((language) => t(language, "no_problem") === state.say);
    if (!keepLit) setSpotlightIds(state.spotlightIds);
    setHeard(typeof state.transcript === "string" && state.transcript ? state.transcript : null);
    if (!opts.keepVoice || state.speakTicket) beginSpeech(state, mine);
    return state;
  }

  useEffect(() => {
    if (session?.phase !== "abandoned") return;
    liveSessionId.current = null;
    seenActivity.current = 0;
    seenCart.current = 0;
    setSession(null);
    setMenu(null);
    setShowMenu(false);
    setOpening(false);
    show("attract");
    setReadBack(null);
    setPicker(null);
    setNotice(null);
    setSay(null);
    setHeard(null);
    setSpotlightIds([]);
    stopTalkRef.current();
    stopPlayback();
  }, [session]);

  function isNewerSession(next: OrderSession): boolean {
    if (liveSessionId.current && next.id !== liveSessionId.current) return false;
    if (next.lastActivityAt < seenActivity.current || next.cartVersion < seenCart.current) return false;
    seenActivity.current = next.lastActivityAt;
    seenCart.current = next.cartVersion;
    return true;
  }

  function retreat(): boolean {
    if (sheetBack.current) {
      sheetBack.current = false;
      return true;
    }
    const here = screenRef.current;
    const next: Screen = here === "pay" ? "review" : here === "review" ? "menu" : "attract";
    if (next === here) return false;
    show(next);
    if (next === "menu") setShowMenu(true);
    if (next === "review" || next === "attract") setShowMenu(false);
    if (next === "attract") {
      setOpening(false);
      stopTalkRef.current();
    }
    return true;
  }

  function stepBack() {
    if (picker) {
      setPicker(null);
      setSay(t(languageRef.current.language, "going_back"));
      return;
    }
    const moved = retreat();
    setSay(moved ? t(languageRef.current.language, "going_back") : screenText(languageRef.current.language, "home_screen"));
  }

  function run(command: OrderInput) {
    if (!session) return Promise.resolve(null);
    return post(`/api/sessions/${session.id}`, command);
  }

  async function start(machineId: MachineId) {
    requestSeq.current += 1;
    liveSessionId.current = null;
    seenActivity.current = 0;
    seenCart.current = 0;
    setPicker(null);
    setMenu(machineId);
    setShowMenu(true);
    const choice = languageRef.current;
    await post(
      "/api/sessions",
      {
        machineId,
        ...(choice.pinned ? { language: choice.language } : {}),
      },
      { keepVoice: true },
    );
  }

  function chooseLanguage(next: AppLanguage) {
    languageRef.current = { language: next, pinned: true };
    setLanguage(next);
    setLanguagePinned(true);
    setSay((current) => retargetSay(current, next));
    const live = session && session.phase !== "abandoned" ? session : null;
    if (live) {
      void fetch(`/api/sessions/${live.id}/language`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: next }),
      });
    }
  }

  function cancel() {
    if (!session || session.phase === "abandoned") {
      setSession(null);
      setMenu(null);
      setShowMenu(false);
      setOpening(false);
      show("attract");
      stopTalkRef.current();
      return;
    }
    void run({ type: "cancel" });
  }

  function send(text: string) {
    if (!session) return;
    sheetBack.current = picker != null;
    setPicker(null);
    // Rules-clear confirm from Review: paint Pay before the session round trip (like Menu welcome).
    if (
      screenRef.current === "review" &&
      readBack &&
      session.phase === "awaiting_confirmation" &&
      (isClearYes(text) || (wantsNoMore(text) && !wantsChange(text)))
    ) {
      paintPayOptimistic();
    }
    const choice = languageRef.current;
    void post(`/api/sessions/${session.id}/message`, {
      text,
      ...(choice.pinned ? { language: choice.language } : {}),
    });
  }

  function sendClip(clip: { blob: Blob; seconds: number }) {
    if (!soloRef.current) return Promise.resolve(null);
    sheetBack.current = picker != null;
    setPicker(null);
    const body = new FormData();
    const ext = clip.blob.type.includes("mp4") ? "mp4" : clip.blob.type.includes("ogg") ? "ogg" : "webm";
    body.append("audio", clip.blob, `talk.${ext}`);
    body.append("seconds", String(clip.seconds));
    if (languageRef.current.pinned) body.append("language", languageRef.current.language);
    if (screenRef.current === "attract" || !session) {
      return post("/api/arrive", body);
    }
    return post(`/api/sessions/${session.id}/speech`, body);
  }

  const [leaveSeconds, setLeaveSeconds] = useState<number | null>(null);
  const endingVisit = useRef(false);
  const paused = useRef(false);
  const talk = useConversation({
    enabled: session === null || session.phase !== "abandoned",
    onClip: sendClip,
    onArm: armAudio,
    onStop: stopPlayback,
    onMiss: () => setNotice(screenText(languageRef.current.language, "mic_blocked")),
    onSilent: () => {
      if (screenRef.current === "attract") setSay(t(languageRef.current.language, "didnt_catch"));
    },
    onVoice: setVoiceSample,
    isSpeaking: () => speakingNow.current,
  });
  const talkRef = useRef(talk);
  talkRef.current = talk;
  stopTalkRef.current = () => talkRef.current.stop();

  useEffect(() => {
    if (!leading) {
      talkRef.current.stop();
      stopPlayback();
    }
  }, [leading]);

  // Attract idle: prefetch welcome TTS for the current language into welcomeAudio.
  useEffect(() => {
    if (screen !== "attract") return;
    prefetchWelcome(language, languagePinned);
  }, [screen, language, languagePinned]);

  // Menu with a complete cart: debounce warm read-back TTS so Review / checkout is cache-ready.
  useEffect(() => {
    if (session) invalidateReadBackCache(session.cartVersion);
    if (opening) return;
    if (!session || session.phase === "abandoned") return;
    if (session.phase !== "browsing" && session.phase !== "drafting") return;
    if (screen === "pay" || screen === "attract") return;
    if (!cartReadyForReadBack(session)) return;
    const lang: AppLanguage = isAppLanguage(session.preferredLanguage)
      ? session.preferredLanguage
      : language;
    const sessionId = session.id;
    const cartVersion = session.cartVersion;
    const timer = window.setTimeout(() => {
      prefetchReadBack(sessionId, cartVersion, lang);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [session, screen, opening, language, languagePinned]);

  // Review: debounce warm ready_to_pay TTS so Confirm / voice yes plays from cache.
  useEffect(() => {
    if (opening) return;
    if (!session || session.phase !== "awaiting_confirmation") return;
    if (screen !== "review") return;
    if (!cartReadyForReadBack(session)) return;
    const lang: AppLanguage = isAppLanguage(session.preferredLanguage)
      ? session.preferredLanguage
      : language;
    const sessionId = session.id;
    const cartVersion = session.cartVersion;
    const timer = window.setTimeout(() => {
      prefetchReadyPay(sessionId, cartVersion, lang);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [session, screen, opening, language, languagePinned]);

  const orderOpen = Boolean(session && session.phase !== "abandoned");
  const activityAt = session?.lastActivityAt ?? 0;

  // Idle leave only: quiet window (BLIND_BEFORE_COUNTDOWN_MS) then LEAVE_COUNTDOWN_MS. Attract never counts down.
  useEffect(() => {
    if (!orderOpen || screen === "attract") {
      endingVisit.current = false;
      setLeaveSeconds(null);
      return;
    }
    const timer = window.setInterval(() => {
      const left = leaveSecondsLeft(Date.now() - activityAt, BLIND_BEFORE_COUNTDOWN_MS);
      setLeaveSeconds(left);
      if (left === 0 && !endingVisit.current && liveSessionId.current) {
        endingVisit.current = true;
        void post(`/api/sessions/${liveSessionId.current}`, { type: "cancel" });
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [orderOpen, screen, activityAt]);

  /**
   * Start a machine from a tap — demo card, or the bound unit's single Start button.
   * Must run inside the user gesture: browsers keep audio locked until one, so an
   * effect-driven auto-start would paint the menu with a silent welcome and prompts.
   * Paint menu + set machineId, kick welcome voice, then await session POST.
   */
  function beginFromMachine(machineId: MachineId) {
    // Unlock playback first, synchronously inside the tap gesture.
    void audioContext().resume();
    paused.current = false;
    setHeard(null);
    const choice = languageRef.current;
    setSay(t(choice.language, welcomeKey(machineId)));
    // Optimistic menu: do not gate paint on the session round trip.
    setOpening(true);
    setMenu(machineId);
    setShowMenu(true);
    show("menu");
    // Welcome TTS runs beside the session POST.
    speakWelcome(choice.language, choice.pinned, machineId);
    void (async () => {
      await start(machineId);
      setOpening(false);
      if (liveSessionId.current) talk.start();
    })();
  }

  /** Demo-only header tabs: hop machines while the cart is empty (bound units never get tabs). */
  function switchMachine(machineId: MachineId) {
    if (MACHINE_BOUND || machineId === menu || opening) return;
    if ((session?.lines.length ?? 0) > 0) return;
    stopTalkRef.current();
    beginFromMachine(machineId);
  }

  function onTalk() {
    // Do not open the mic until the session is live (opening menu has no session id yet).
    if (opening || !liveSessionId.current) return;
    if (talk.phase === "off") {
      paused.current = false;
      talk.start();
    } else {
      paused.current = true;
      talk.stop();
    }
  }

  const thinking = talk.phase === "thinking";
  const orderLive = Boolean(session && session.phase !== "abandoned");
  const item = picker ? getItem(picker.productId) : undefined;

  let body: ReactNode;
  if (screen === "attract") {
    // Bound unit: one Start tap (unlocks audio); demo: the two-card machine picker.
    body = MACHINE_BOUND ? (
      <BoundAttract
        notice={notice}
        language={language}
        onChooseLanguage={chooseLanguage}
        onStart={() => beginFromMachine(DEFAULT_MACHINE)}
      />
    ) : (
      <Attract
        say={say}
        heard={heard}
        notice={notice}
        language={language}
        onChooseLanguage={chooseLanguage}
        onSelectMachine={beginFromMachine}
      />
    );
  } else if (screen === "pay" && readBack && session) {
    body = (
      <Pay
        readBack={readBack}
        say={say}
        heard={heard}
        speaking={speaking}
        talkPhase={talk.phase}
        voiceSample={voiceSample}
        onToggleTalk={onTalk}
        onSend={send}
        onChange={() => void run({ type: "revise" })}
        onBack={stepBack}
        onNew={cancel}
        thinking={thinking}
        language={language}
      />
    );
  } else if (screen === "review" && readBack && session) {
    body = (
      <Review
        readBack={readBack}
        notice={notice}
        say={say}
        heard={heard}
        speaking={speaking}
        talkPhase={talk.phase}
        voiceSample={voiceSample}
        onToggleTalk={onTalk}
        onSend={send}
        onConfirm={() => {
          paintPayOptimistic();
          void run({
            type: "confirm",
            cartVersion: readBack.cartVersion,
            source: "confirm_tap",
          });
        }}
        onChange={() => void run({ type: "revise" })}
        onBack={stepBack}
        thinking={thinking}
        language={language}
      />
    );
  } else if (screen === "menu" && menu) {
    body = (
      <Menu
        session={session && session.phase !== "abandoned" ? session : null}
        menu={menu}
        opening={opening}
        notice={notice}
        say={say}
        heard={heard}
        speaking={speaking}
        talkPhase={talk.phase}
        voiceSample={voiceSample}
        onToggleTalk={onTalk}
        spotlightIds={spotlightIds}
        uiPulse={uiPulse}
        onSend={send}
        onCancel={cancel}
        onBack={stepBack}
        onPick={(productId) => setPicker({ productId })}
        onEditTemp={(lineId, productId) => setPicker({ lineId, productId })}
        onQuantity={(lineId, quantity) => void run({ type: "set_quantity", lineId, quantity })}
        onSetTemp={(lineId, temperature) => void run({ type: "set_temperature", lineId, temperature })}
        onRemove={(lineId) => void run({ type: "remove_line", lineId })}
        onReview={() => void run({ type: "read_back" })}
        onSwitchMachine={MACHINE_BOUND ? undefined : switchMachine}
        onChooseLanguage={chooseLanguage}
        thinking={thinking}
        language={language}
      />
    );
  } else if (!orderLive || !session) {
    body = MACHINE_BOUND ? (
      <BoundAttract
        notice={notice}
        language={language}
        onChooseLanguage={chooseLanguage}
        onStart={() => beginFromMachine(DEFAULT_MACHINE)}
      />
    ) : (
      <Attract
        say={say}
        heard={heard}
        notice={notice}
        language={language}
        onChooseLanguage={chooseLanguage}
        onSelectMachine={beginFromMachine}
      />
    );
  } else {
    body = (
      <Menu
        session={session}
        menu={menu ?? session.machineId}
        opening={false}
        notice={notice}
        say={say}
        heard={heard}
        speaking={speaking}
        talkPhase={talk.phase}
        voiceSample={voiceSample}
        onToggleTalk={onTalk}
        spotlightIds={spotlightIds}
        uiPulse={uiPulse}
        onSend={send}
        onCancel={cancel}
        onBack={stepBack}
        onPick={(productId) => setPicker({ productId })}
        onEditTemp={(lineId, productId) => setPicker({ lineId, productId })}
        onQuantity={(lineId, quantity) => void run({ type: "set_quantity", lineId, quantity })}
        onSetTemp={(lineId, temperature) => void run({ type: "set_temperature", lineId, temperature })}
        onRemove={(lineId) => void run({ type: "remove_line", lineId })}
        onReview={() => void run({ type: "read_back" })}
        onSwitchMachine={MACHINE_BOUND ? undefined : switchMachine}
        onChooseLanguage={chooseLanguage}
        thinking={thinking}
        language={language}
      />
    );
  }

  const leaving = leaveSeconds != null && leaveSeconds > 0;
  const shownSeconds = leaveSeconds ?? 0;

  return (
    <main className={styles.frame}>
      <div className={styles.shell}>
      <section
        className={styles.screen}
        lang={language}
        dir={language === "he" ? "rtl" : "ltr"}
        aria-label="Vending machine"
        aria-busy={thinking || undefined}
      >
        <div className={leaving ? styles.screenBlur : styles.screenFace}>
        {body}
        {item && session && session.phase !== "abandoned" && session.phase !== "ready_to_pay" ? (
          <ProductSheet
            item={item}
            lineId={picker?.lineId}
            session={session}
            language={language}
            busy={thinking}
            onClose={() => {
              void run({ type: "activity" });
              setPicker(null);
            }}
            onAdd={(temperature) => {
              void (async () => {
                if (picker?.lineId) {
                  if (!temperature) return;
                  const saved = await run({
                    type: "set_temperature",
                    lineId: picker.lineId,
                    temperature,
                  });
                  if (saved && !saved.notice) setPicker(null);
                  return;
                }
                const added = await run({
                  type: "add",
                  productId: item.id,
                  ...(temperature ? { temperature } : {}),
                });
                if (added && !added.notice) setPicker(null);
              })();
            }}
          />
        ) : null}
        </div>
        {leaving ? (
          <LeaveRing
            seconds={shownSeconds}
            label={t(session?.preferredLanguage, "order_ends_in", { time: formatLeaveClock(shownSeconds) })}
          />
        ) : null}
      </section>
      </div>
    </main>
  );
}

function LeaveRing({ seconds, label }: { seconds: number; label: string }) {
  const total = LEAVE_COUNTDOWN_MS / 1000;
  const radius = 54;
  const turn = 2 * Math.PI * radius;
  const left = Math.min(1, Math.max(0, seconds / total));
  return (
    <div className={styles.leave} role="timer" aria-live="polite" aria-atomic="true" aria-label={label}>
      <svg className={styles.leaveRing} viewBox="0 0 140 140" aria-hidden="true">
        <circle className={styles.leaveTrack} cx="70" cy="70" r={radius} />
        <circle
          className={styles.leaveProgress}
          cx="70"
          cy="70"
          r={radius}
          style={{ strokeDasharray: turn, strokeDashoffset: turn * (1 - left) }}
        />
      </svg>
      <p className={styles.leaveTime}>{formatLeaveClock(seconds)}</p>
    </div>
  );
}

/** Shown in the Attract status strip. Production units set NEXT_PUBLIC_UNIT_ID; the demo shows a placeholder. */
const UNIT_ID = process.env.NEXT_PUBLIC_UNIT_ID?.trim() || "DEMO-01";
/** How long an early orb tap keeps the “Pick a machine below” nudge + card pulse on screen. */
const ATTRACT_NUDGE_MS = 3200;

const ATTRACT_PICKS: { id: MachineId; image: string; blurb: "coffee_blurb" | "snacks_blurb"; tone: "cyan" | "magenta" }[] = [
  { id: "coffee", image: "/images/coffee/coffee-01.webp", blurb: "coffee_blurb", tone: "cyan" },
  { id: "snacks", image: "/images/snacks/snacks-01.webp", blurb: "snacks_blurb", tone: "magenta" },
];

/**
 * Demo home screen (shown only when NEXT_PUBLIC_MACHINE_ID is unset/empty).
 * The machine cards are the only real start: whole card / Start Order → onSelectMachine
 * (beginFromMachine: optimistic menu + welcome + listening). Orb never opens the mic —
 * early tap only nudges “Pick a machine below”. Bound units show BoundAttract instead.
 */
function Attract({
  say,
  heard,
  notice,
  language,
  onChooseLanguage,
  onSelectMachine,
}: {
  say: string | null;
  heard: string | null;
  notice: string | null;
  language: AppLanguage;
  onChooseLanguage: (language: AppLanguage) => void;
  onSelectMachine: (id: MachineId) => void;
}) {
  const [nudge, setNudge] = useState(0);
  const cardsRef = useRef<HTMLDivElement>(null);
  const nudging = nudge > 0;

  useEffect(() => {
    if (!nudge) return;
    cardsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const timer = window.setTimeout(() => setNudge(0), ATTRACT_NUDGE_MS);
    return () => window.clearTimeout(timer);
  }, [nudge]);

  return (
    <div className={styles.attract}>
      <header className={styles.attractHead}>
        <div className={styles.brand}>
          <img className={styles.brandLogo} src="/brand/futureino-logo-clear.png" alt="Futureino" />
          <span className={styles.brandTag}>{screenText(language, "smart_kiosk")}</span>
        </div>
        <div className={styles.langChips} role="group" aria-label={screenText(language, "language")}>
          {LANGUAGES.map((option) => (
            <button
              key={option.id}
              type="button"
              lang={option.id}
              className={option.id === language ? styles.langChipOn : styles.langChip}
              aria-pressed={option.id === language}
              aria-label={option.label}
              title={option.label}
              onClick={() => onChooseLanguage(option.id)}
            >
              {option.code}
            </button>
          ))}
        </div>
      </header>

      <section className={styles.orbStage} aria-label={screenText(language, "tap_or_speak")}>
        <button
          type="button"
          className={nudging ? `${styles.orb} ${styles.orbNudge}` : styles.orb}
          aria-describedby="attract-orb-hint"
          onClick={() => setNudge((count) => count + 1)}
        >
          <span className={styles.orbHalo} aria-hidden />
          <span className={styles.orbCore}>
            <span className={styles.orbLabel}>{screenText(language, "tap_or_speak")}</span>
          </span>
        </button>
        <p id="attract-orb-hint" className={styles.orbHint}>
          {screenText(language, "orb_hint")}
        </p>
      </section>

      <div className={styles.attractTranscript} role="status" aria-live="polite">
        {nudging ? (
          <p className={styles.attractNudge}>{screenText(language, "pick_machine_below")}</p>
        ) : heard || say ? (
          <>
            {heard ? <p className={styles.attractHeard}>{screenText(language, "you_said", { text: heard })}</p> : null}
            {say ? <p className={styles.attractSay}>{say}</p> : null}
          </>
        ) : (
          <p className={styles.attractExample}>{screenText(language, "example_order")}</p>
        )}
      </div>

      {notice ? (
        <p className={styles.attractNotice} role="alert">
          {notice}
        </p>
      ) : null}

      <p className={styles.demoLine}>{screenText(language, "demo_choose")}</p>
      <div ref={cardsRef} className={styles.machineRow} data-nudge={nudging ? "true" : "false"}>
        {ATTRACT_PICKS.map((pick, index) => {
          const meta = MACHINES[pick.id];
          const blurb = screenText(language, pick.blurb);
          const cta = screenText(language, "start_order");
          return (
            <button
              key={pick.id}
              type="button"
              className={styles.machineCard}
              data-tone={pick.tone}
              style={{ animationDelay: `${120 + index * 120}ms` }}
              aria-label={`${meta.name}. ${blurb}. ${cta}`}
              onClick={() => onSelectMachine(pick.id)}
            >
              <span className={styles.machineArt}>
                <img src={pick.image} alt="" />
              </span>
              <span className={styles.machineTitle}>{meta.name}</span>
              <span className={styles.machineBlurb}>{blurb}</span>
              <span className={styles.machineCta} aria-hidden>
                {cta}
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                  <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>

      <footer className={styles.attractFoot}>
        <p className={styles.noisyTip}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
            <path d="M4 10v4h3l4 4V6L7 10H4Z" fill="currentColor" />
            <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>{screenText(language, "noisy_tip")}</span>
        </p>
        <p className={styles.unitStatus}>
          <span className={styles.statusDot} aria-hidden />
          <span>{screenText(language, "voice_touch")}</span>
          <span className={styles.statusSep} aria-hidden>
            |
          </span>
          <span>{screenText(language, "unit", { id: UNIT_ID })}</span>
          <span className={styles.statusSep} aria-hidden>
            |
          </span>
          <span>{(LANGUAGES.find((option) => option.id === language) ?? LANGUAGES[0]).code}</span>
        </p>
      </footer>
    </div>
  );
}

/**
 * Bound-unit home screen (NEXT_PUBLIC_MACHINE_ID=coffee|snacks): logo + language chips and
 * one primary Start button, no machine cards. The tap is the user gesture that unlocks
 * audio, so the welcome and later prompts can play — never auto-start without it.
 */
function BoundAttract({
  notice,
  language,
  onChooseLanguage,
  onStart,
}: {
  notice: string | null;
  language: AppLanguage;
  onChooseLanguage: (language: AppLanguage) => void;
  onStart: () => void;
}) {
  const label = screenText(language, "tap_to_start");
  return (
    <div className={styles.attract}>
      <header className={styles.attractHead}>
        <div className={styles.brand}>
          <img className={styles.brandLogo} src="/brand/futureino-logo-clear.png" alt="Futureino" />
          <span className={styles.brandTag}>{screenText(language, "smart_kiosk")}</span>
        </div>
        <div className={styles.langChips} role="group" aria-label={screenText(language, "language")}>
          {LANGUAGES.map((option) => (
            <button
              key={option.id}
              type="button"
              lang={option.id}
              className={option.id === language ? styles.langChipOn : styles.langChip}
              aria-pressed={option.id === language}
              aria-label={option.label}
              title={option.label}
              onClick={() => onChooseLanguage(option.id)}
            >
              {option.code}
            </button>
          ))}
        </div>
      </header>

      <section className={`${styles.orbStage} ${styles.boundStage}`}>
        <button
          type="button"
          className={styles.orb}
          aria-label={label.replace(/\s+/g, " ")}
          onClick={onStart}
        >
          <span className={styles.orbHalo} aria-hidden />
          <span className={styles.orbCore}>
            <span className={`${styles.orbLabel} ${styles.orbLabelLines}`}>{label}</span>
          </span>
        </button>
      </section>

      {notice ? (
        <p className={styles.attractNotice} role="alert">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function Menu({
  session,
  menu,
  opening,
  notice,
  say,
  heard,
  speaking,
  talkPhase,
  voiceSample,
  onToggleTalk,
  spotlightIds,
  uiPulse,
  onSend,
  onCancel,
  onBack,
  onPick,
  onEditTemp,
  onQuantity,
  onSetTemp,
  onRemove,
  onReview,
  onSwitchMachine,
  onChooseLanguage,
  thinking,
  language,
}: {
  session: OrderSession | null;
  menu: MachineId;
  /** True until the session POST lands — UI Designer binds skeleton chrome to this. */
  opening: boolean;
  notice: string | null;
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  voiceSample: VoiceSample | null;
  onToggleTalk: () => void;
  spotlightIds: string[];
  uiPulse: { command: UiCommand; id: number } | null;
  onSend: (text: string) => void;
  onCancel: () => void;
  onBack: () => void;
  onPick: (productId: string) => void;
  onEditTemp: (lineId: string, productId: string) => void;
  onQuantity: (lineId: string, quantity: number) => void;
  onSetTemp: (lineId: string, temperature: Temperature) => void;
  onRemove: (lineId: string) => void;
  onReview: () => void;
  onSwitchMachine?: (machineId: MachineId) => void;
  onChooseLanguage: (language: AppLanguage) => void;
  thinking: boolean;
  language: AppLanguage;
}) {
  const products = itemsForMachine(menu);
  const wide = useWide();
  const lines = session?.lines ?? [];
  const missing = new Set(
    lines.filter((line) => getItem(line.productId)?.requiresTemperature && !line.temperature).map((line) => line.lineId),
  );
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const [cartOpen, setCartOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  /** Touch CTAs / composer / cart qty — default closed for pure conversation. */
  const [controlsOpen, setControlsOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const spotlightKey = spotlightIds.join("|");
  const busy = thinking || opening || !session;
  /** Lit offer in rank order (engine order), limited to this machine's grid — badge n = index + 1. */
  const lit = spotlightIds.filter((id) => products.some((product) => product.id === id));
  const showing = opening ? [] : lit.map((id) => products.find((product) => product.id === id)?.name ?? id);

  useEffect(() => {
    if (!spotlightIds.length || !gridRef.current) return;
    const first = spotlightIds[0];
    const card = gridRef.current.querySelector<HTMLElement>(`[data-product-id="${first}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [spotlightKey, spotlightIds]);

  useEffect(() => {
    if (!uiPulse) return;
    if (uiPulse.command === "go_back") return;
    if (uiPulse.command === "open_cart") {
      setCartOpen(true);
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;
    const delta = Math.max(180, Math.floor(grid.clientHeight * 0.7));
    const next = grid.scrollTop + (uiPulse.command === "scroll_down" ? delta : -delta);
    grid.scrollTop = Math.max(0, next);
  }, [uiPulse]);

  const missingKey = [...missing].sort().join("|");
  useEffect(() => {
    if (lines.length === 0) setCartOpen(false);
  }, [lines.length]);
  useEffect(() => {
    if (missing.size > 0) {
      setCartOpen(true);
      setControlsOpen(true);
    }
  }, [missingKey, missing.size]);

  const total = session ? cartTotal(session) : 0;
  const networkFail = isNetworkNotice(notice);
  // Desktop: controls (cart, Review, Start over, language) always visible in the side panel.
  const showControls = controlsOpen || wide;
  const tabs = wide && onSwitchMachine ? (Object.keys(MACHINES) as MachineId[]) : null;
  const micMode = talkPhase === "off" ? "off" : speaking ? "speaking" : talkPhase === "thinking" ? "thinking" : "listening";
  const micLabel = micMode === "off" ? screenText(language, "talk") : screenText(language, micMode);

  return (
    <div className={styles.menuView}>
      <header className={styles.topbar}>
        <div className={styles.menuBrand}>
          <img className={styles.menuLogo} src="/brand/futureino-logo-clear.png" alt="Futureino" />
          {tabs ? null : <h2>{MACHINES[menu].name}</h2>}
        </div>
        {tabs ? (
          <nav className={styles.machineTabs} aria-label="Machines">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                className={id === menu ? styles.machineTabOn : styles.machineTab}
                aria-pressed={id === menu}
                disabled={id !== menu && (busy || count > 0)}
                onClick={() => {
                  if (id !== menu) onSwitchMachine?.(id);
                }}
              >
                {MACHINES[id].name}
              </button>
            ))}
          </nav>
        ) : null}
      </header>
      <Reply say={say} heard={heard} language={language} showing={showing} />
      <div
        ref={gridRef}
        className={[styles.grid, thinking || opening ? styles.gridBusy : "", showing.length ? styles.gridLit : ""]
          .filter(Boolean)
          .join(" ")}
        aria-busy={thinking || opening || undefined}
        data-opening={opening ? "true" : "false"}
      >
        {opening
          ? Array.from({ length: 6 }, (_, index) => (
              <div key={`open-skel-${index}`} className={styles.cardSkeleton} aria-hidden>
                <div className={styles.skeletonThumb} />
                <div className={styles.skeletonLine} />
                <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
              </div>
            ))
          : products.map((product) => {
              const rank = lit.indexOf(product.id) + 1;
              return (
              <article
                key={product.id}
                data-product-id={product.id}
                className={rank > 0 ? `${styles.card} ${styles.spot}` : styles.card}
              >
                {rank > 0 ? (
                  <span className={styles.spotBadge} aria-hidden>
                    {rank}
                  </span>
                ) : null}
                <img src={`/${product.imagePath}`} alt="" />
                <span className={styles.cardName}>{product.name}</span>
                <span className={styles.cardPrice}>{money(product.priceCents)}</span>
                <button
                  type="button"
                  className={styles.addPill}
                  onClick={() => onPick(product.id)}
                  disabled={busy}
                >
                  {product.requiresTemperature
                    ? screenText(language, "add_custom")
                    : screenText(language, "add")}
                </button>
              </article>
              );
            })}
      </div>
      <footer className={styles.dock} aria-label="Cart" data-opening={opening ? "true" : "false"}>
        {count > 0 ? (
          <p className={styles.cartStatus} role="status">
            {screenText(language, count === 1 ? "item_one" : "item_many", { count })} · {money(total)}
            {missing.size > 0 ? ` · ${screenText(language, "needs_temp")}` : ""}
          </p>
        ) : null}
        {notice ? (
          <p className={networkFail ? `${styles.notice} ${styles.noticeFail}` : styles.notice} role="status">
            {notice}
          </p>
        ) : null}
        {wide ? (
          <div className={styles.panelMic}>
            <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} mic language={language} />
            <p className={styles.panelMicLabel} aria-hidden>
              {micLabel}
            </p>
            {talkPhase === "listening" ? <VoiceLine sample={voiceSample} language={language} /> : null}
          </div>
        ) : (
          <div className={styles.voiceRow}>
            <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} compact language={language} />
            {talkPhase === "listening" ? <VoiceLine sample={voiceSample} language={language} /> : null}
          </div>
        )}
        {showControls ? (
          <div className={styles.controlsPanel}>
            {count === 0 ? (
              <p className={styles.empty}>{screenText(language, "tap_add")}</p>
            ) : (
              <button
                type="button"
                className={styles.cartSummary}
                aria-expanded={cartOpen}
                onClick={() => setCartOpen((open) => !open)}
                disabled={busy}
              >
                <span>
                  {screenText(language, count === 1 ? "item_one" : "item_many", { count })} · {money(total)}
                  {missing.size > 0 ? ` · ${screenText(language, "needs_temp")}` : ""}
                </span>
                <span className={styles.cartChevron} aria-hidden>
                  {cartOpen ? "▾" : "▸"}
                </span>
              </button>
            )}
            {cartOpen && lines.length > 0 ? (
              <div className={styles.lines}>
                {lines.map((line) => {
                  const product = getItem(line.productId);
                  const unit = product?.priceCents ?? 0;
                  return (
                    <div key={line.lineId} className={styles.line}>
                      <strong>
                        {product?.name ?? line.productId}
                        {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                      </strong>
                      <span className={styles.price}>{money(unit * line.quantity)}</span>
                      {line.temperature ? (
                        <button
                          type="button"
                          className={styles.meta}
                          onClick={() => onEditTemp(line.lineId, line.productId)}
                          disabled={busy}
                        >
                          {line.temperature ? tempWord(language, line.temperature) : ""}
                        </button>
                      ) : null}
                      {missing.has(line.lineId) ? (
                        <div className={styles.tempPick} role="group" aria-label={tempWord(language, "hot")}>
                          {TEMP_IDS.map((temp) => (
                            <button
                              key={temp}
                              type="button"
                              onClick={() => onSetTemp(line.lineId, temp)}
                              disabled={busy}
                            >
                              {tempWord(language, temp)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className={styles.qty}>
                        <button
                          type="button"
                          aria-label={`Decrease ${product?.name ?? "item"}`}
                          onClick={() => onQuantity(line.lineId, line.quantity - 1)}
                          disabled={busy || line.quantity <= 1}
                        >
                          −
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Increase ${product?.name ?? "item"}`}
                          onClick={() => onQuantity(line.lineId, line.quantity + 1)}
                          disabled={busy || line.quantity >= 9}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className={styles.remove}
                          onClick={() => onRemove(line.lineId)}
                          disabled={busy}
                        >
                          {screenText(language, "remove")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <p className={styles.orSay}>{screenText(language, "menu_hint")}</p>
            {typeOpen ? (
              <Composer onSend={onSend} disabled={busy} onClose={() => setTypeOpen(false)} language={language} />
            ) : (
              <button
                type="button"
                className={styles.typeInstead}
                onClick={() => setTypeOpen(true)}
                disabled={busy}
              >
                {screenText(language, "type_instead")}
              </button>
            )}
            <button
              type="button"
              className={styles.primary}
              onClick={onReview}
              disabled={busy || count === 0 || missing.size > 0}
            >
              {count === 0 ? screenText(language, "review_order") : screenText(language, "review_total", { total: money(total) })}
            </button>
            <div className={styles.controlsNav}>
              <button type="button" className={styles.ghost} onClick={onBack} disabled={thinking}>
                {screenText(language, "back")}
              </button>
              <button type="button" className={styles.ghost} onClick={onCancel} disabled={thinking}>
                {screenText(language, "start_over")}
              </button>
            </div>
            {wide ? (
              <label className={styles.panelLang}>
                <span>{screenText(language, "language")}</span>
                <select value={language} onChange={(event) => onChooseLanguage(event.target.value as AppLanguage)}>
                  {LANGUAGES.map((option) => (
                    <option key={option.id} value={option.id} lang={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        {wide ? null : (
          <button
            type="button"
            className={styles.expandToggle}
            aria-expanded={controlsOpen}
            onClick={() => setControlsOpen((open) => !open)}
          >
            {controlsOpen ? screenText(language, "collapse") : screenText(language, "expand")}
          </button>
        )}
      </footer>
    </div>
  );
}

function ProductSheet({
  item,
  lineId,
  session,
  language,
  busy,
  onClose,
  onAdd,
}: {
  item: CatalogItem;
  lineId?: string;
  session: OrderSession;
  language: AppLanguage;
  busy: boolean;
  onClose: () => void;
  onAdd: (temperature?: Temperature) => void;
}) {
  const existing = lineId ? session.lines.find((line) => line.lineId === lineId) : undefined;
  const [temperature, setTemperature] = useState<Temperature | undefined>(existing?.temperature);
  const needsTemp = item.requiresTemperature;
  const blocked = needsTemp && !temperature;

  return (
    <div className={styles.backdrop} onClick={busy ? undefined : onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-labelledby="sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <img src={`/${item.imagePath}`} alt="" />
        <h2 id="sheet-title">{item.name}</h2>
        <p className={styles.summary}>{item.summary}</p>
        <p className={styles.note}>{screenText(language, "allergens_note")}</p>
        {needsTemp ? (
          <div className={styles.temps} role="group" aria-label={screenText(language, "hot")}>
            {TEMP_IDS.map((temp) => (
              <button
                key={temp}
                type="button"
                className={temperature === temp ? `${styles.temp} ${styles.tempOn}` : styles.temp}
                aria-pressed={temperature === temp}
                onClick={() => setTemperature(temp)}
                disabled={busy}
              >
                <strong>{tempWord(language, temp)}</strong>
                <small>{tempHint(language, temp)}</small>
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className={styles.primary}
          disabled={busy || blocked}
          onClick={() => onAdd(temperature)}
        >
          {lineId ? screenText(language, "save_temp") : screenText(language, "add_order", { price: money(item.priceCents) })}
        </button>
        <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
          {screenText(language, "close")}
        </button>
      </div>
    </div>
  );
}

function Review({
  readBack,
  notice,
  say,
  heard,
  speaking,
  talkPhase,
  voiceSample,
  onToggleTalk,
  onSend,
  onConfirm,
  onChange,
  onBack,
  thinking,
  language,
}: {
  readBack: ReadBack;
  notice: string | null;
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  voiceSample: VoiceSample | null;
  onToggleTalk: () => void;
  onSend: (text: string) => void;
  onConfirm: () => void;
  onChange: () => void;
  onBack: () => void;
  thinking: boolean;
  language: AppLanguage;
}) {
  const networkFail = isNetworkNotice(notice);
  const [controlsOpen, setControlsOpen] = useState(false);
  return (
    <div className={styles.review}>
      <div>
        <p className={styles.kicker}>{screenText(language, "check_order")}</p>
        <h1 className={styles.title}>{screenText(language, "confirm_prompt")}</h1>
        <Reply say={say} heard={heard} language={language} />
        <ul className={styles.reviewList}>
          {readBack.lines.map((line) => (
            <li key={line.lineId}>
              <span>
                <strong>
                  {line.name}
                  {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                </strong>
                <span className={styles.meta}>
                  {line.temperature ? ` ${tempWord(language, line.temperature)}` : ""}
                </span>
              </span>
              <span className={styles.price}>{money(line.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <p className={styles.total}>
          <span>{screenText(language, "total")}</span>
          <span>{money(readBack.totalCents)}</span>
        </p>
      </div>
      <div className={styles.stack}>
        {notice ? (
          <p className={networkFail ? `${styles.notice} ${styles.noticeFail}` : styles.notice} role="status">
            {notice}
          </p>
        ) : null}
        <div className={styles.voiceRow}>
          <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} language={language} />
          {talkPhase === "listening" ? <VoiceLine sample={voiceSample} language={language} /> : null}
        </div>
        {/* Confirm is always on screen: the spoken read-back tells them to tap it. Back and Change stay behind Expand. */}
        <button type="button" className={`${styles.primary} ${styles.reviewConfirm}`} onClick={onConfirm} disabled={thinking}>
          {screenText(language, "confirm")}
        </button>
        {controlsOpen ? (
          <div className={styles.controlsPanel}>
            <p className={styles.orSay}>{screenText(language, "say_back_page")}</p>
            <Composer onSend={onSend} disabled={thinking} modest language={language} />
            <button type="button" className={styles.ghost} onClick={onBack} disabled={thinking}>
              {screenText(language, "back")}
            </button>
            <button type="button" className={styles.ghost} onClick={onChange} disabled={thinking}>
              {screenText(language, "change_order")}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={styles.expandToggle}
          aria-expanded={controlsOpen}
          onClick={() => setControlsOpen((open) => !open)}
        >
          {controlsOpen ? screenText(language, "collapse") : screenText(language, "expand")}
        </button>
      </div>
    </div>
  );
}

function Pay({
  readBack,
  say,
  heard,
  speaking,
  talkPhase,
  voiceSample,
  onToggleTalk,
  onSend,
  onChange,
  onBack,
  onNew,
  thinking,
  language,
}: {
  readBack: ReadBack;
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  voiceSample: VoiceSample | null;
  onToggleTalk: () => void;
  onSend: (text: string) => void;
  onChange: () => void;
  onBack: () => void;
  onNew: () => void;
  thinking: boolean;
  language: AppLanguage;
}) {
  /** Demo display-only split. TOTAL DUE stays catalog `totalCents` (operator/readBack truth). */
  const totalCents = readBack.totalCents;
  const taxCents = Math.round(totalCents * 0.08);
  const subtotalCents = totalCents - taxCents;
  const itemCount = readBack.lines.reduce((sum, line) => sum + line.quantity, 0);
  const [method, setMethod] = useState<"card" | "mobile" | "loyalty">("card");
  const [controlsOpen, setControlsOpen] = useState(false);

  return (
    <div className={styles.pay}>
      <header className={styles.payHead}>
        <img className={styles.payLogo} src="/brand/futureino-logo-clear.png" alt="Futureino" />
      </header>
      <Reply say={say} heard={heard} language={language} />
      <div className={styles.payBody}>
        <h2 className={styles.payCartTitle}>
          {screenText(language, itemCount === 1 ? "your_cart_one" : "your_cart", { count: itemCount })}
        </h2>
        <ul className={styles.payCartList}>
          {readBack.lines.map((line) => (
            <li key={line.lineId} className={styles.payCartLine}>
              <span className={styles.payCartMeta}>
                <span className={styles.payCartName}>{line.name}</span>
                {line.temperature ? (
                  <span className={styles.payCartDot}> · {tempWord(language, line.temperature)}</span>
                ) : null}
                <span className={styles.payCartDot}> · ×{line.quantity}</span>
              </span>
              <span className={styles.payCartPrice}>{money(line.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <div className={styles.payBreakdown}>
          <div className={styles.payRow}>
            <span>{screenText(language, "subtotal")}</span>
            <span>{money(subtotalCents)}</span>
          </div>
          <div className={styles.payRow}>
            <span>{screenText(language, "tax")}</span>
            <span>{money(taxCents)}</span>
          </div>
          <div className={styles.payDue} role="status">
            <span>{screenText(language, "total_due")}</span>
            <span>{money(totalCents)}</span>
          </div>
        </div>
        <p className={styles.payMethodLabel}>{screenText(language, "select_payment")}</p>
        <div className={styles.payMethods} role="radiogroup" aria-label={screenText(language, "select_payment")}>
          {(
            [
              { id: "card" as const, label: "pay_card" as const, icon: "card" },
              { id: "mobile" as const, label: "pay_mobile" as const, icon: "mobile" },
              { id: "loyalty" as const, label: "pay_loyalty" as const, icon: "loyalty" },
            ] as const
          ).map((tile) => (
            <button
              key={tile.id}
              type="button"
              role="radio"
              aria-checked={method === tile.id}
              className={method === tile.id ? `${styles.payMethod} ${styles.payMethodOn}` : styles.payMethod}
              onClick={() => setMethod(tile.id)}
              disabled={thinking}
            >
              <PayMethodIcon kind={tile.icon} />
              <span>{screenText(language, tile.label)}</span>
            </button>
          ))}
        </div>
        <p className={styles.payDemoNote}>{screenText(language, "pay_stops")}</p>
      </div>
      <div className={styles.payDock}>
        <div className={styles.voiceRow}>
          <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} language={language} />
          {talkPhase === "listening" ? <VoiceLine sample={voiceSample} language={language} /> : null}
        </div>
        <p className={styles.payUnit}>{screenText(language, "unit", { id: UNIT_ID })}</p>
        <p className={styles.payHint}>{screenText(language, "say_confirm_pay")}</p>
        {controlsOpen ? (
          <div className={styles.controlsPanel}>
            <Composer onSend={onSend} disabled={thinking} modest language={language} />
            <div className={styles.payActions}>
              <button type="button" className={styles.ghost} onClick={onBack} disabled={thinking}>
                {screenText(language, "back")}
              </button>
              <button type="button" className={styles.ghost} onClick={onChange} disabled={thinking}>
                {screenText(language, "change_order")}
              </button>
              <button type="button" className={styles.primary} onClick={onNew} disabled={thinking}>
                {screenText(language, "new_order")}
              </button>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className={styles.expandToggle}
          aria-expanded={controlsOpen}
          onClick={() => setControlsOpen((open) => !open)}
        >
          {controlsOpen ? screenText(language, "collapse") : screenText(language, "expand")}
        </button>
      </div>
    </div>
  );
}

function PayMethodIcon({ kind }: { kind: "card" | "mobile" | "loyalty" }) {
  if (kind === "card") {
    return (
      <svg className={styles.payMethodIcon} viewBox="0 0 24 24" aria-hidden>
        <rect x="2" y="5" width="20" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M2 10h20" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6 15h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "mobile") {
    return (
      <svg className={styles.payMethodIcon} viewBox="0 0 24 24" aria-hidden>
        <rect x="7" y="2.5" width="10" height="19" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="17.5" r="1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className={styles.payMethodIcon} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3.2l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 8.4l5-.7L12 3.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}


function Reply({
  say,
  heard,
  language,
  showing = [],
}: {
  say: string | null;
  heard: string | null;
  language: AppLanguage;
  /** Names of the lit offer, in spotlight order (Menu only). Product names stay English. */
  showing?: string[];
}) {
  if (!say && !heard && showing.length === 0) return null;
  return (
    <div className={styles.say} role="status" aria-live="polite">
      {heard ? (
        <p className={styles.heard}>
          <span className={styles.chatTag}>{screenText(language, "you_tag")}</span>
          <span className={styles.chatText}>{heard}</span>
        </p>
      ) : null}
      {showing.length ? (
        <p className={styles.showing}>
          <span aria-hidden>👉 </span>
          {screenText(language, "showing", { names: showing.join(" · ") })}
        </p>
      ) : null}
      {say ? (
        <p className={styles.sayLine}>
          <span className={styles.chatTag}>{screenText(language, "machine_tag")}</span>
          <span className={styles.chatText}>{say}</span>
        </p>
      ) : null}
    </div>
  );
}

type TalkPhase = "off" | "listening" | "thinking";

function useConversation(opts: {
  enabled: boolean;
  onClip: (clip: { blob: Blob; seconds: number }) => Promise<unknown>;
  onArm: () => AudioContext;
  onStop: () => void;
  onMiss: () => void;
  onSilent: () => void;
  onVoice: (sample: VoiceSample | null) => void;
  isSpeaking: () => boolean;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const live = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<TalkPhase>("off");

  function closeMic() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function end() {
    live.current = false;
    setPhase("off");
    closeMic();
    optsRef.current.onVoice(null);
    optsRef.current.onStop();
  }

  async function openMic(): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      if (!live.current) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }
      streamRef.current = stream;
      return stream;
    } catch {
      live.current = false;
      setPhase("off");
      optsRef.current.onMiss();
      return null;
    }
  }

  function releaseMic(stream: MediaStream | null) {
    stream?.getTracks().forEach((track) => track.stop());
    if (stream && streamRef.current === stream) streamRef.current = null;
  }

  async function loop() {
    const meter = optsRef.current.onArm();
    while (live.current) {
      const stream = await openMic();
      if (!stream) return;
      setPhase("listening");
      const blob = await captureUtterance(stream, () => live.current, meter, (sample) => optsRef.current.onVoice(sample));
      releaseMic(stream);
      if (!live.current) break;
      if (!blob) {
        optsRef.current.onSilent();
        continue;
      }
      setPhase("thinking");
      await optsRef.current.onClip(blob);
      while (live.current && optsRef.current.isSpeaking()) {
        await wait(80);
      }
      if (live.current) await wait(PLAYBACK_TAIL_MS);
    }
    if (!live.current) setPhase("off");
  }

  useEffect(() => {
    if (!opts.enabled && live.current) end();
  }, [opts.enabled]);

  useEffect(() => {
    return () => {
      live.current = false;
      closeMic();
    };
  }, []);

  function start() {
    if (live.current) return;
    live.current = true;
    setPhase("listening");
    void loop();
  }

  function stop() {
    if (!live.current) return;
    end();
  }

  function toggle() {
    if (live.current) stop();
    else start();
  }

  return { phase, toggle, start, stop };
}

function Talk({
  phase,
  speaking,
  onToggle,
  hero,
  compact,
  circle,
  mic,
  startLabel,
  language = "en",
}: {
  phase: TalkPhase;
  speaking: boolean;
  onToggle: () => void;
  hero?: boolean;
  compact?: boolean;
  circle?: boolean;
  mic?: boolean;
  startLabel?: string;
  language?: AppLanguage;
}) {
  const live = phase !== "off";
  const mode = !live ? "off" : speaking ? "speaking" : phase === "thinking" ? "thinking" : "listening";
  const idle = startLabel ?? screenText(language, "talk");
  const label =
    mode === "off"
      ? idle
      : mode === "speaking"
        ? circle || mic
          ? screenText(language, "speaking")
          : screenText(language, "speaking_end")
        : mode === "thinking"
          ? circle || mic
            ? screenText(language, "thinking")
            : screenText(language, "thinking_end")
          : circle || mic
            ? screenText(language, "listening")
            : screenText(language, "listening_end");
  const className = [
    styles.talk,
    hero ? styles.talkHero : "",
    compact ? styles.talkCompact : "",
    circle ? styles.talkCircle : "",
    mic ? styles.talkMic : "",
    mode === "listening" ? styles.talkListening : "",
    mode === "thinking" ? styles.talkThinking : "",
    mode === "speaking" ? styles.talkSpeaking : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      aria-pressed={live}
      aria-label={mic ? label : undefined}
      data-talk-state={mode}
      onClick={onToggle}
    >
      {mic ? (
        <span className={styles.micIcon} aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
            <path
              d="M12 3a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 1 0 7 0v-5A3.5 3.5 0 0 0 12 3Z"
              fill="currentColor"
            />
            <path
              d="M7 11.5a5 5 0 0 0 10 0M12 16.5V20"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
      ) : (
        <span className={styles.talkDot} aria-hidden />
      )}
      {mic ? <span className={styles.srOnly}>{label}</span> : label}
    </button>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const VOICE_BARS = 24;
const VOICE_GATE = 0.04;

type VoiceSample = { bars: number[]; hearing: boolean };

function frequencyBars(analyser: AnalyserNode, freq: Uint8Array<ArrayBuffer>): number[] {
  analyser.getByteFrequencyData(freq);
  const usable = Math.max(VOICE_BARS, Math.floor(freq.length * 0.4));
  const step = usable / VOICE_BARS;
  const bars: number[] = [];
  for (let i = 0; i < VOICE_BARS; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    let peak = 0;
    for (let j = start; j < end && j < freq.length; j++) peak = Math.max(peak, freq[j] ?? 0);
    bars.push(peak / 255);
  }
  return bars;
}

function VoiceLine({ sample, language }: { sample: VoiceSample | null; language: AppLanguage }) {
  const bars = sample?.bars ?? Array.from({ length: VOICE_BARS }, () => 0);
  // Pack a readable meter into the circle without changing the sampler count.
  const shown = bars.filter((_, index) => index % 2 === 0);
  const hearing = sample?.hearing ?? false;
  const label = hearing ? screenText(language, "voice_captured") : screenText(language, "listening_caption");
  return (
    <div
      className={styles.voiceLine}
      data-hearing={hearing ? "true" : "false"}
      role="meter"
      aria-label={hearing ? screenText(language, "voice_captured") : screenText(language, "voice_on")}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={hearing ? 1 : 0}
      title={label}
    >
      <span className={styles.voiceBars} aria-hidden="true">
        {shown.map((bar, index) => (
          <span
            key={index}
            className={styles.voiceBar}
            style={{ height: `${Math.max(10, Math.round(bar * 100))}%` }}
          />
        ))}
      </span>
      <span className={styles.srOnly}>{label}</span>
    </div>
  );
}

/** Record until the customer pauses. Returns null when the pause had no speech. */
function captureUtterance(
  stream: MediaStream,
  live: () => boolean,
  context: AudioContext,
  onVoice: (sample: VoiceSample | null) => void,
): Promise<{ blob: Blob; seconds: number } | null> {
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  void context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.65;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.fftSize);
  const freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  recorder.start(200);

  return new Promise((resolve) => {
    const started = Date.now();
    let voiceMs = 0;
    let lastVoice = 0;
    let lastTick = started;
    const timer = window.setInterval(() => {
      if (!live() || recorder.state === "inactive") {
        window.clearInterval(timer);
        onVoice(null);
        finish(false);
        return;
      }
      analyser.getByteTimeDomainData(bins);
      let sum = 0;
      for (const value of bins) {
        const sample = (value - 128) / 128;
        sum += sample * sample;
      }
      const level = Math.sqrt(sum / bins.length);
      const now = Date.now();
      const loud = level >= VOICE_GATE;
      if (loud) {
        voiceMs += now - lastTick;
        lastVoice = now;
      }
      lastTick = now;
      const armed = voiceMs >= VOICE_HOLD_MS;
      onVoice({
        bars: loud ? frequencyBars(analyser, freq) : Array.from({ length: VOICE_BARS }, () => 0),
        hearing: armed,
      });
      const quietFor = lastVoice === 0 ? 0 : now - lastVoice;
      const ready = utteranceReady(voiceMs, quietFor, now - started);
      if (ready !== "wait") {
        window.clearInterval(timer);
        onVoice(null);
        finish(ready === "send");
      }
    }, 50);

    function finish(send: boolean) {
      const done = () => {
        source.disconnect();
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const seconds = (Date.now() - started) / 1000;
        resolve(send && blob.size >= 500 ? { blob, seconds } : null);
      };
      if (recorder.state === "inactive") {
        done();
        return;
      }
      recorder.onstop = done;
      recorder.stop();
    }
  });
}

function Composer({
  onSend,
  disabled,
  modest,
  onClose,
  language,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  modest?: boolean;
  onClose?: () => void;
  language: AppLanguage;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className={modest ? `${styles.composer} ${styles.composerModest}` : styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        const value = text.trim();
        if (!value || disabled) return;
        setText("");
        onSend(value);
      }}
    >
      <input
        aria-label={screenText(language, "type_order")}
        placeholder={modest ? screenText(language, "type_here") : screenText(language, "type_order")}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className={styles.send} disabled={disabled}>
        Send
      </button>
      {onClose ? (
        <button type="button" className={styles.composerClose} onClick={onClose} aria-label={screenText(language, "hide_typing")}>
          ✕
        </button>
      ) : null}
    </form>
  );
}

function cartTotal(session: OrderSession): number {
  return session.lines.reduce((sum, line) => sum + (getItem(line.productId)?.priceCents ?? 0) * line.quantity, 0);
}
