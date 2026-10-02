"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getItem,
  itemsForMachine,
  MACHINES,
  type CatalogItem,
  type MachineId,
  type Temperature,
} from "../catalog/index";
import { parseNavIntent, type UiCommand } from "../agent/nav";
import { APP_LANGUAGES, isAppLanguage, t, ui as screenText, type AppLanguage } from "../i18n";
import { isHeyFuture } from "../agent/arrive";
import { formatLeaveClock, LEAVE_COUNTDOWN_MS, leaveSecondsLeft } from "./leave";
import { utteranceReady, VOICE_HOLD_MS } from "./voice";
import { type WatchStatus } from "./presence";
import { useSoloKiosk } from "./solo";
import { useCustomerWatch } from "./watch";
import { type OrderInput, type OrderSession, type ReadBack } from "../order/engine";
import styles from "./kiosk.module.css";

type Screen = "attract" | "machines" | "menu" | "review" | "pay";
type Picker = { productId: string; lineId?: string };

const LANGUAGES: { id: AppLanguage; code: string; label: string }[] = [
  { id: "en", code: "EN", label: "English" },
  { id: "es", code: "ES", label: "Español" },
  { id: "fr", code: "FR", label: "Français" },
  { id: "he", code: "HE", label: "עברית" },
  { id: "af", code: "AF", label: "Afrikaans" },
];

const TEMP_IDS: Temperature[] = ["hot", "iced", "room"];

function tempWord(language: AppLanguage, id: Temperature): string {
  return screenText(language, id);
}

function tempHint(language: AppLanguage, id: Temperature): string {
  if (id === "hot") return screenText(language, "hot_hint");
  if (id === "iced") return screenText(language, "iced_hint");
  return screenText(language, "room_hint");
}

function cameraText(status: WatchStatus, language: AppLanguage): string {
  if (status === "starting") return screenText(language, "cam_starting");
  if (status === "blocked") return screenText(language, "cam_blocked");
  if (status === "looking") return screenText(language, "cam_looking");
  if (status === "seen") return screenText(language, "cam_seen");
  if (status === "unavailable") return screenText(language, "cam_unavailable");
  return "";
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
  switchTo?: MachineId | null;
  ui?: UiCommand | null;
  transcript?: string | null;
  audioBase64?: string | null;
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
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageRef = useRef({ language: "en" as AppLanguage, pinned: false });
  languageRef.current = { language, pinned: languagePinned };
  const [menu, setMenu] = useState<MachineId | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [uiPulse, setUiPulse] = useState<{ command: UiCommand; id: number } | null>(null);
  const requestSeq = useRef(0);
  const liveSessionId = useRef<string | null>(null);
  const seenActivity = useRef(0);
  const seenCart = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const meterCtx = useRef<AudioContext | null>(null);
  const voice = useRef<AudioBufferSourceNode | null>(null);
  const speakingNow = useRef(false);
  const leading = useSoloKiosk();
  const soloRef = useRef(true);
  soloRef.current = leading;

  function audioContext(): AudioContext {
    if (!audioCtx.current) audioCtx.current = new AudioContext();
    return audioCtx.current;
  }

  function stopPlayback() {
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

  async function play(base64: string) {
    if (!soloRef.current) return;
    stopPlayback();
    speakingNow.current = true;
    setSpeaking(true);
    try {
      const context = audioContext();
      await context.resume();
      if (!soloRef.current) {
        stopPlayback();
        return;
      }
      const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(binary.buffer.slice(0));
      if (!soloRef.current) {
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

  async function post(url: string, body: unknown, tick = false): Promise<ServerState | null> {
    const mine = tick ? requestSeq.current : ++requestSeq.current;
    const isAudio = body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: isAudio ? undefined : { "content-type": "application/json" },
        body: isAudio ? body : JSON.stringify(body),
      });
    } catch {
      if (!tick && mine === requestSeq.current) {
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
      if (!tick && mine === requestSeq.current) setNotice(message);
      return null;
    }
    const state = (await response.json()) as ServerState;
    if (mine !== requestSeq.current) return state;
    const transcript = typeof state.transcript === "string" ? state.transcript.trim() : "";
    const heardNav = !tick ? parseNavIntent(transcript) : null;
    const ui = !tick ? (state.ui ?? (heardNav?.kind === "ui" ? heardNav.ui : null)) : null;
    const goingBack = ui === "go_back";
    if (!tick && screenRef.current === "attract") {
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
      if (isHeyFuture(transcript)) {
        setSay(null);
        show("machines");
        return state;
      }
      setSay(transcript ? screenText(languageRef.current.language, "hey_future") : state.say ?? screenText(languageRef.current.language, "hey_future"));
      return state;
    }
    const nextSession = state.session;
    if (nextSession && !isNewerSession(nextSession, tick)) return state;
    const movedBack = goingBack ? retreat() : false;
    if (!goingBack) sheetBack.current = false;
    if (!tick && !goingBack) {
      if (ui && nextSession) {
        setShowMenu(true);
        show("menu");
        setUiPulse((prev) => ({ command: ui, id: (prev?.id ?? 0) + 1 }));
      } else if (state.switchTo) {
        setMenu(state.switchTo);
        setShowMenu(true);
        show("menu");
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
    if (tick) {
      if (nextSession && liveSessionId.current === nextSession.id) {
        setSession(nextSession);
        setReadBack(state.readBack);
      }
      return state;
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
    if (!goingBack) setReadBack(state.switchTo ? null : state.readBack);
    setNotice(state.notice);
    setSay(goingBack && !movedBack ? screenText(languageRef.current.language, "home_screen") : state.say);
    setSpotlightIds(state.spotlightIds);
    setHeard(typeof state.transcript === "string" && state.transcript ? state.transcript : null);
    if (state.audioBase64) void play(state.audioBase64);
    else stopPlayback();
    return state;
  }

  useEffect(() => {
    if (!session || session.phase === "abandoned") return;
    const id = session.id;
    const timer = window.setInterval(() => {
      void post(`/api/sessions/${id}`, { type: "tick" }, true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.phase]);

  useEffect(() => {
    if (session?.phase !== "abandoned") return;
    liveSessionId.current = null;
    seenActivity.current = 0;
    seenCart.current = 0;
    setSession(null);
    setMenu(null);
    setShowMenu(false);
    show("attract");
    setReadBack(null);
    setPicker(null);
    setNotice(null);
    setSay(null);
    setHeard(null);
    setSpotlightIds([]);
    stopPlayback();
  }, [session]);

  function isNewerSession(next: OrderSession, tick: boolean): boolean {
    if (liveSessionId.current && next.id !== liveSessionId.current) return false;
    if (!liveSessionId.current && tick) return false;
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
    const next: Screen = here === "pay" ? "review" : here === "review" ? "menu" : here === "menu" ? "machines" : "attract";
    if (next === here) return false;
    show(next);
    if (next === "menu") setShowMenu(true);
    if (next === "review") setShowMenu(false);
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

  function openMachine(machineId: MachineId) {
    if (session && session.phase !== "abandoned") {
      setPicker(null);
      setMenu(machineId);
      setShowMenu(true);
      show("menu");
      return;
    }
    void start(machineId);
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
    await post("/api/sessions", {
      machineId,
      ...(choice.pinned ? { language: choice.language } : {}),
    });
  }

  function chooseLanguage(next: AppLanguage) {
    languageRef.current = { language: next, pinned: true };
    setLanguage(next);
    setLanguagePinned(true);
    setLanguageOpen(false);
    const live = session && session.phase !== "abandoned" ? session : null;
    if (live) void post(`/api/sessions/${live.id}/language`, { language: next });
  }

  function cancel() {
    if (!session || session.phase === "abandoned") {
      setSession(null);
      setMenu(null);
      setShowMenu(false);
      show("attract");
      return;
    }
    void run({ type: "cancel" });
  }

  function send(text: string) {
    if (!session) return;
    sheetBack.current = picker != null;
    setPicker(null);
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
      if (screenRef.current === "attract") body.append("intent", "wake");
      return post("/api/arrive", body);
    }
    return post(`/api/sessions/${session.id}/speech`, body);
  }

  const [camera, setCamera] = useState<HTMLVideoElement | null>(null);
  const watch = useCustomerWatch(camera);
  const [leaveSeconds, setLeaveSeconds] = useState<number | null>(null);
  const awayAt = useRef<number | null>(null);
  const endingVisit = useRef(false);
  const paused = useRef(false);
  const talk = useConversation({
    enabled: session === null || session.phase !== "abandoned",
    onClip: sendClip,
    onArm: armAudio,
    onStop: stopPlayback,
    onMiss: () => setNotice(screenText(languageRef.current.language, "mic_blocked")),
    onSilent: () => {
      if (screenRef.current === "attract") setSay(screenText(languageRef.current.language, "hey_future"));
    },
    onVoice: setVoiceSample,
    isSpeaking: () => speakingNow.current,
  });
  const talkRef = useRef(talk);
  talkRef.current = talk;

  useEffect(() => {
    if (!leading) {
      talkRef.current.stop();
      stopPlayback();
      return;
    }
    if (watch.present) {
      if (!paused.current) talkRef.current.start();
      return;
    }
    paused.current = false;
    talkRef.current.stop();
  }, [watch.present, leading]);

  const orderOpen = Boolean(session && session.phase !== "abandoned");
  const cameraAway = screen !== "attract" && watch.status === "looking";

  useEffect(() => {
    if (!cameraAway) {
      awayAt.current = null;
      endingVisit.current = false;
      setLeaveSeconds(null);
      return;
    }
    if (awayAt.current == null) awayAt.current = Date.now();
    const timer = window.setInterval(() => {
      const started = awayAt.current;
      if (started == null) return;
      const left = leaveSecondsLeft(Date.now() - started);
      setLeaveSeconds(left);
      if (left === 0 && orderOpen && !endingVisit.current && liveSessionId.current) {
        endingVisit.current = true;
        void post(`/api/sessions/${liveSessionId.current}`, { type: "cancel" });
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [cameraAway, orderOpen, screen]);

  function onTalk() {
    watch.enable();
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
    body = (
      <Attract
        say={say}
        heard={heard}
        notice={notice}
        speaking={speaking}
        talkPhase={talk.phase}
        onToggleTalk={onTalk}
        onStart={() => show("machines")}
        thinking={thinking}
        language={language}
        languageOpen={languageOpen}
        onToggleLanguage={() => setLanguageOpen((open) => !open)}
        onChooseLanguage={chooseLanguage}
      />
    );
  } else if (screen === "machines" || !orderLive || !session) {
    body = (
      <MachineChoice
        say={say}
        heard={heard}
        speaking={speaking}
        talkPhase={talk.phase}
        onToggleTalk={onTalk}
        onBack={() => {
          setHeard(null);
          setSay(null);
          show("attract");
        }}
        onStart={openMachine}
        thinking={thinking}
        language={language}
      />
    );
  } else if (screen === "pay" && readBack) {
    body = (
      <Pay
        readBack={readBack}
        say={say}
        heard={heard}
        speaking={speaking}
        talkPhase={talk.phase}
        onToggleTalk={onTalk}
        onSend={send}
        onChange={() => void run({ type: "revise" })}
        onBack={stepBack}
        onNew={cancel}
        thinking={thinking}
        language={language}
      />
    );
  } else if (screen === "review" && readBack) {
    body = (
      <Review
        readBack={readBack}
        notice={notice}
        say={say}
        heard={heard}
        speaking={speaking}
        talkPhase={talk.phase}
        onToggleTalk={onTalk}
        onSend={send}
        onConfirm={() =>
          void run({
            type: "confirm",
            cartVersion: readBack.cartVersion,
            source: "confirm_tap",
          })
        }
        onChange={() => void run({ type: "revise" })}
        onBack={stepBack}
        thinking={thinking}
        language={language}
      />
    );
  } else {
    body = (
      <Menu
        session={session}
        menu={menu ?? session.machineId}
        onMenu={setMenu}
        notice={notice}
        say={say}
        heard={heard}
        speaking={speaking}
        talkPhase={talk.phase}
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
        thinking={thinking}
        language={language}
      />
    );
  }

  const leaving = leaveSeconds != null && leaveSeconds > 0;
  const shownSeconds = leaveSeconds ?? 0;

  return (
    <main className={styles.frame}>
      <section
        className={styles.screen}
        lang={language}
        dir={language === "he" ? "rtl" : "ltr"}
        aria-label="Vending machine"
        aria-busy={thinking || undefined}
      >
        <div className={leaving ? styles.screenBlur : styles.screenFace}>
        <video
          ref={setCamera}
          className={watch.status === "looking" || watch.status === "seen" || watch.status === "starting" ? styles.camera : styles.cameraHidden}
          muted
          playsInline
          aria-label="Camera looking for a customer"
        />
        {cameraText(watch.status, language) ? (
          <p className={watch.status === "looking" || watch.status === "seen" ? styles.cameraNoteOn : styles.cameraNote}>
            {cameraText(watch.status, language)}
          </p>
        ) : null}
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
        {talk.phase === "listening" ? <VoiceLine sample={voiceSample} language={language} /> : null}
        </div>
        {leaving ? (
          <LeaveRing
            seconds={shownSeconds}
            label={t(session?.preferredLanguage, "order_ends_in", { time: formatLeaveClock(shownSeconds) })}
          />
        ) : null}
      </section>
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

function Attract({
  say,
  heard,
  notice,
  speaking,
  talkPhase,
  onToggleTalk,
  onStart,
  thinking,
  language,
  languageOpen,
  onToggleLanguage,
  onChooseLanguage,
}: {
  say: string | null;
  heard: string | null;
  notice: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  onToggleTalk: () => void;
  onStart: () => void;
  thinking: boolean;
  language: AppLanguage;
  languageOpen: boolean;
  onToggleLanguage: () => void;
  onChooseLanguage: (language: AppLanguage) => void;
}) {
  return (
    <div className={styles.attract}>
      <img className={styles.logo} src="/brand/futureino-logo-trimmed.png" alt="Futureino" />
      <h1 className={styles.welcome}>{screenText(language, "welcome")}</h1>
      <div className={styles.attractHero}>
        <Reply say={say} heard={heard} language={language} />
        {notice ? <p className={styles.notice}>{notice}</p> : null}
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} circle language={language} startLabel={screenText(language, "tap_to_start")} />
        <p className={styles.attractHint}>{screenText(language, "hey_future")}</p>
        <button type="button" className={styles.attractBrowse} onClick={onStart} disabled={thinking}>
          {screenText(language, "browse")}
        </button>
        <LanguageButton
          language={language}
          open={languageOpen}
          onToggle={onToggleLanguage}
          onChoose={onChooseLanguage}
        />
      </div>
    </div>
  );
}

function LanguageButton({
  language,
  open,
  onToggle,
  onChoose,
}: {
  language: AppLanguage;
  open: boolean;
  onToggle: () => void;
  onChoose: (language: AppLanguage) => void;
}) {
  const current = LANGUAGES.find((item) => item.id === language) ?? LANGUAGES[0];
  const code = current?.code ?? "EN";
  const label = current ? `Language, ${current.label}` : "Language";
  return (
    <div className={styles.langDock}>
      {open ? (
        <div className={styles.langMenu} role="listbox" aria-label="Language">
          {LANGUAGES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === language}
              className={option.id === language ? styles.langOptionOn : styles.langOption}
              onClick={() => onChoose(option.id)}
            >
              <span className={styles.langCode}>{option.code}</span>
              <span dir="auto">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={open ? styles.langButtonOn : styles.langButton}
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
      >
        {code}
      </button>
    </div>
  );
}

function MachineChoice({
  say,
  heard,
  speaking,
  talkPhase,
  onToggleTalk,
  onBack,
  onStart,
  thinking,
  language,
}: {
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  onToggleTalk: () => void;
  onBack: () => void;
  onStart: (machineId: MachineId) => void;
  thinking: boolean;
  language: AppLanguage;
}) {
  const live = talkPhase !== "off" || speaking || Boolean(heard) || Boolean(say);
  const art: Record<MachineId, string> = {
    coffee: "/images/coffee/coffee-01.webp",
    snacks: "/images/snacks/snacks-01.webp",
  };
  const sayWord: Record<MachineId, string> = {
    coffee: screenText(language, "say_coffee"),
    snacks: screenText(language, "say_snacks"),
  };
  const blurb: Record<MachineId, string> = {
    coffee: screenText(language, "coffee_blurb"),
    snacks: screenText(language, "snacks_blurb"),
  };
  const idle =
    talkPhase === "listening"
      ? screenText(language, "listening")
      : talkPhase === "thinking"
        ? screenText(language, "thinking")
        : speaking
          ? screenText(language, "speaking")
          : screenText(language, "tap_mic");

  return (
    <div className={styles.choose}>
      <div className={styles.chooseHead}>
        <h1 className={styles.chooseTitle}>{screenText(language, "what_after")}</h1>
        <div className={styles.voiceRow} data-live={live || undefined}>
          <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} mic language={language} />
          <div className={styles.voiceTranscript} role="status">
            {heard ? (
              <p className={styles.heard}>{screenText(language, "you_said", { text: heard })}</p>
            ) : say ? (
              <p className={styles.sayLine}>{say}</p>
            ) : (
              <p className={styles.voiceIdle}>{idle}</p>
            )}
          </div>
        </div>
      </div>
      <div className={styles.machineCards}>
        {(Object.keys(MACHINES) as MachineId[]).map((id) => (
          <button
            key={id}
            type="button"
            className={styles.machineCard}
            onClick={() => onStart(id)}
            disabled={thinking}
          >
            <span className={styles.machineArt} aria-hidden>
              <img src={art[id]} alt="" />
            </span>
            <span className={styles.machineBody}>
              <strong>{MACHINES[id].name}</strong>
              <span className={styles.machineBlurb}>{blurb[id]}</span>
              <span className={styles.sayHint}>{sayWord[id]}</span>
            </span>
          </button>
        ))}
      </div>
      <div className={styles.chooseFoot}>
        <button type="button" className={styles.backBtn} onClick={onBack} disabled={thinking}>
          {screenText(language, "back")}
        </button>
        <p className={styles.orSay}>{screenText(language, "or_say_back")}</p>
      </div>
    </div>
  );
}

function Menu({
  session,
  menu,
  onMenu,
  notice,
  say,
  heard,
  speaking,
  talkPhase,
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
  thinking,
  language,
}: {
  session: OrderSession;
  menu: MachineId;
  onMenu: (machineId: MachineId) => void;
  notice: string | null;
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
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
  thinking: boolean;
  language: AppLanguage;
}) {
  const products = itemsForMachine(menu);
  const missing = new Set(
    session.lines.filter((line) => getItem(line.productId)?.requiresTemperature && !line.temperature).map((line) => line.lineId),
  );
  const count = session.lines.reduce((sum, line) => sum + line.quantity, 0);
  const [cartOpen, setCartOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const spotlightKey = spotlightIds.join("|");

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
    if (session.lines.length === 0) setCartOpen(false);
  }, [session.lines.length]);
  useEffect(() => {
    if (missing.size > 0) setCartOpen(true);
  }, [missingKey, missing.size]);

  const total = cartTotal(session);
  const networkFail = isNetworkNotice(notice);

  return (
    <>
      <header className={styles.topbar}>
        <div>
          <p>Futureino</p>
          <h2>{MACHINES[menu].name}</h2>
          <div className={styles.menus}>
            {(Object.keys(MACHINES) as MachineId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={id === menu ? styles.menuOn : styles.menuOff}
                aria-pressed={id === menu}
                onClick={() => onMenu(id)}
                disabled={thinking}
              >
                {MACHINES[id].name}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.menus}>
          <button type="button" className={styles.linkish} onClick={onBack} disabled={thinking}>
            {screenText(language, "back")}
          </button>
          <button type="button" className={styles.linkish} onClick={onCancel} disabled={thinking}>
            {screenText(language, "start_over")}
          </button>
        </div>
      </header>
      <Reply say={say} heard={heard} language={language} />
      <div
        ref={gridRef}
        className={thinking ? `${styles.grid} ${styles.gridBusy}` : styles.grid}
        aria-busy={thinking || undefined}
      >
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            data-product-id={product.id}
            className={spotlightIds.includes(product.id) ? `${styles.card} ${styles.spot}` : styles.card}
            onClick={() => onPick(product.id)}
            disabled={thinking}
          >
            <img src={`/${product.imagePath}`} alt="" />
            <span className={styles.cardName}>{product.name}</span>
            <span className={styles.cardPrice}>{money(product.priceCents)}</span>
          </button>
        ))}
      </div>
      <footer className={styles.dock} aria-label="Cart">
        {count === 0 ? (
          <p className={styles.empty}>{screenText(language, "tap_add")}</p>
        ) : (
          <button
            type="button"
            className={styles.cartSummary}
            aria-expanded={cartOpen}
            onClick={() => setCartOpen((open) => !open)}
            disabled={thinking}
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
        {cartOpen && session.lines.length > 0 ? (
          <div className={styles.lines}>
            {session.lines.map((line) => {
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
                      disabled={thinking}
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
                          disabled={thinking}
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
                      disabled={thinking || line.quantity <= 1}
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${product?.name ?? "item"}`}
                      onClick={() => onQuantity(line.lineId, line.quantity + 1)}
                      disabled={thinking || line.quantity >= 9}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => onRemove(line.lineId)}
                      disabled={thinking}
                    >
                      {screenText(language, "remove")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {notice ? (
          <p className={networkFail ? `${styles.notice} ${styles.noticeFail}` : styles.notice} role="status">
            {notice}
          </p>
        ) : null}
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} compact language={language} />
        <p className={styles.orSay}>{screenText(language, "menu_hint")}</p>
        {typeOpen ? (
          <Composer onSend={onSend} disabled={thinking} onClose={() => setTypeOpen(false)} language={language} />
        ) : (
          <button
            type="button"
            className={styles.typeInstead}
            onClick={() => setTypeOpen(true)}
            disabled={thinking}
          >
            {screenText(language, "type_instead")}
          </button>
        )}
        <button
          type="button"
          className={styles.primary}
          onClick={onReview}
          disabled={thinking || count === 0 || missing.size > 0}
        >
          {count === 0 ? screenText(language, "review_order") : screenText(language, "review_total", { total: money(total) })}
        </button>
      </footer>
    </>
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
  onToggleTalk: () => void;
  onSend: (text: string) => void;
  onConfirm: () => void;
  onChange: () => void;
  onBack: () => void;
  thinking: boolean;
  language: AppLanguage;
}) {
  const networkFail = isNetworkNotice(notice);
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
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} language={language} />
        <p className={styles.orSay}>{screenText(language, "say_back_page")}</p>
        <Composer onSend={onSend} disabled={thinking} modest language={language} />
        <button type="button" className={styles.ghost} onClick={onBack} disabled={thinking}>
          {screenText(language, "back")}
        </button>
        <button type="button" className={styles.primary} onClick={onConfirm} disabled={thinking}>
          {screenText(language, "confirm")}
        </button>
        <button type="button" className={styles.ghost} onClick={onChange} disabled={thinking}>
          {screenText(language, "change_order")}
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
  onToggleTalk: () => void;
  onSend: (text: string) => void;
  onChange: () => void;
  onBack: () => void;
  onNew: () => void;
  thinking: boolean;
  language: AppLanguage;
}) {
  return (
    <div className={styles.pay}>
      <div>
        <p className={styles.kicker}>{screenText(language, "ready_pay")}</p>
        <h1 className={styles.title}>{screenText(language, "pay_here")}</h1>
        <p className={styles.payTotal}>{money(readBack.totalCents)}</p>
        <p className={styles.summary}>{screenText(language, "pay_stops")}</p>
        <Reply say={say} heard={heard} language={language} />
        <ul className={styles.reviewList}>
          {readBack.lines.map((line) => (
            <li key={line.lineId}>
              <span>
                {line.name}
                {line.temperature ? ` · ${tempWord(language, line.temperature)}` : ""}
                {line.quantity > 1 ? ` × ${line.quantity}` : ""}
              </span>
              <span className={styles.price}>{money(line.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.stack}>
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} language={language} />
        <p className={styles.orSay}>{screenText(language, "say_back_page")}</p>
        <Composer onSend={onSend} disabled={thinking} modest language={language} />
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
  );
}

function Reply({ say, heard, language }: { say: string | null; heard: string | null; language: AppLanguage }) {
  if (!say && !heard) return null;
  return (
    <div className={styles.say} role="status">
      {heard ? <p className={styles.heard}>{screenText(language, "you_said", { text: heard })}</p> : null}
      {say ? <p className={styles.sayLine}>{say}</p> : null}
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
      if (live.current) await wait(400);
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
  const hearing = sample?.hearing ?? false;
  return (
    <div
      className={styles.voiceLine}
      data-hearing={hearing ? "true" : "false"}
      role="meter"
      aria-label={hearing ? screenText(language, "voice_captured") : screenText(language, "voice_on")}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={hearing ? 1 : 0}
    >
      <span className={styles.voiceBars} aria-hidden="true">
        {bars.map((bar, index) => (
          <span key={index} className={styles.voiceBar} style={{ height: `${Math.round(12 + bar * 88)}%` }} />
        ))}
      </span>
      <span className={styles.voiceCaption}>{hearing ? screenText(language, "voice_captured") : screenText(language, "listening_caption")}</span>
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
