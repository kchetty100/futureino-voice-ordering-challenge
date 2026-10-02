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
import type { UiCommand } from "../agent/nav";
import { t } from "../i18n";
import { isHeyFuture } from "../agent/arrive";
import { watchLabel } from "./presence";
import { useSoloKiosk } from "./solo";
import { useCustomerWatch } from "./watch";
import { type OrderInput, type OrderSession, type ReadBack } from "../order/engine";
import styles from "./kiosk.module.css";

type Stage = "attract" | "machines";
type Picker = { productId: string; lineId?: string };

const TEMPS: { id: Temperature; label: string; hint: string }[] = [
  { id: "hot", label: "Hot", hint: "Steaming" },
  { id: "iced", label: "Iced", hint: "Over ice" },
  { id: "room", label: "Room", hint: "No heat" },
];

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
  const [stage, setStage] = useState<Stage>("attract");
  const [session, setSession] = useState<OrderSession | null>(null);
  const [readBack, setReadBack] = useState<ReadBack | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [say, setSay] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [spotlightIds, setSpotlightIds] = useState<string[]>([]);
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
        setNotice("Couldn't reach the machine. Check the connection and try Talk again.");
      }
      return null;
    }
    if (!response.ok) {
      let message = "Couldn't reach the machine. Check the connection and try Talk again.";
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
    if (!tick && stage === "attract") {
      const transcript = typeof state.transcript === "string" ? state.transcript.trim() : "";
      setHeard(transcript || null);
      setNotice(null);
      setSpotlightIds([]);
      setReadBack(null);
      if (isHeyFuture(transcript)) {
        setSay(null);
        setStage("machines");
        return state;
      }
      setSay(transcript ? "Say Hey Future to start." : state.say ?? "Say Hey Future to start.");
      return state;
    }
    const nextSession = state.session;
    if (nextSession && !isNewerSession(nextSession, tick)) return state;
    if (state.switchTo) {
      setMenu(state.switchTo);
      setShowMenu(true);
    } else if (!tick && state.readBack && (nextSession?.phase === "awaiting_confirmation" || nextSession?.phase === "ready_to_pay")) {
      setShowMenu(false);
    }
    if (!tick && state.ui) {
      // Scroll and cart dock live on the menu grid.
      setShowMenu(true);
      setUiPulse((prev) => ({ command: state.ui!, id: (prev?.id ?? 0) + 1 }));
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
    }
    setReadBack(state.switchTo ? null : state.readBack);
    setNotice(state.notice);
    setSay(state.say);
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
    setStage("attract");
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
    await post("/api/sessions", { machineId });
  }

  function cancel() {
    if (!session || session.phase === "abandoned") {
      setSession(null);
      setMenu(null);
      setShowMenu(false);
      setStage("attract");
      return;
    }
    void run({ type: "cancel" });
  }

  function send(text: string) {
    if (!session) return;
    setPicker(null);
    void post(`/api/sessions/${session.id}/message`, { text });
  }

  function sendClip(clip: { blob: Blob; seconds: number }) {
    if (!soloRef.current) return Promise.resolve(null);
    setPicker(null);
    const body = new FormData();
    const ext = clip.blob.type.includes("mp4") ? "mp4" : clip.blob.type.includes("ogg") ? "ogg" : "webm";
    body.append("audio", clip.blob, `talk.${ext}`);
    body.append("seconds", String(clip.seconds));
    if (!session) {
      if (stage === "attract") body.append("intent", "wake");
      return post("/api/arrive", body);
    }
    return post(`/api/sessions/${session.id}/speech`, body);
  }

  const [camera, setCamera] = useState<HTMLVideoElement | null>(null);
  const watch = useCustomerWatch(camera);
  const paused = useRef(false);
  const talk = useConversation({
    enabled: session === null || session.phase !== "abandoned",
    onClip: sendClip,
    onArm: armAudio,
    onStop: stopPlayback,
    onMiss: setNotice,
    onSilent: () => setSay("Say Hey Future to start."),
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
  const ended = !session || session.phase === "abandoned";
  const item = picker ? getItem(picker.productId) : undefined;

  let body: ReactNode;
  if (ended) {
    body =
      stage === "machines" ? (
        <MachineChoice
          say={say}
          heard={heard}
          speaking={speaking}
          talkPhase={talk.phase}
          onToggleTalk={onTalk}
          onBack={() => {
            setHeard(null);
            setSay(null);
            setStage("attract");
          }}
          onStart={start}
          thinking={thinking}
        />
      ) : (
        <Attract
          say={say}
          heard={heard}
          notice={notice}
          speaking={speaking}
          talkPhase={talk.phase}
          onToggleTalk={onTalk}
          onStart={() => setStage("machines")}
          thinking={thinking}
        />
      );
  } else if (session.phase === "ready_to_pay" && readBack) {
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
        onNew={cancel}
        thinking={thinking}
      />
    );
  } else if (!showMenu && session.phase === "awaiting_confirmation" && readBack) {
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
        thinking={thinking}
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
        onPick={(productId) => setPicker({ productId })}
        onEditTemp={(lineId, productId) => setPicker({ lineId, productId })}
        onQuantity={(lineId, quantity) => void run({ type: "set_quantity", lineId, quantity })}
        onSetTemp={(lineId, temperature) => void run({ type: "set_temperature", lineId, temperature })}
        onRemove={(lineId) => void run({ type: "remove_line", lineId })}
        onReview={() => void run({ type: "read_back" })}
        thinking={thinking}
      />
    );
  }

  return (
    <main className={styles.frame}>
      <section className={styles.screen} aria-label="Vending machine" aria-busy={thinking || undefined}>
        <video
          ref={setCamera}
          className={watch.status === "looking" || watch.status === "seen" || watch.status === "starting" ? styles.camera : styles.cameraHidden}
          muted
          playsInline
          aria-label="Camera looking for a customer"
        />
        {watchLabel(watch.status) ? (
          <p className={watch.status === "looking" || watch.status === "seen" ? styles.cameraNoteOn : styles.cameraNote}>
            {watchLabel(watch.status)}
          </p>
        ) : null}
        {body}
        {item && session && session.phase !== "abandoned" && session.phase !== "ready_to_pay" ? (
          <ProductSheet
            item={item}
            lineId={picker?.lineId}
            session={session}
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
        {session && session.idlePrompted && session.phase !== "abandoned" && session.phase !== "ready_to_pay" ? (
          <div className={styles.idle} role="dialog" aria-labelledby="idle-title">
            <div className={styles.idleCard}>
              <h2 id="idle-title">{t(session.preferredLanguage, "still_there")}</h2>
              <p className={styles.summary}>The order will clear if nobody is at the machine.</p>
              <button type="button" className={styles.primary} onClick={() => void run({ type: "activity" })}>
                I'm here
              </button>
              <button type="button" className={styles.ghost} onClick={cancel}>
                Start over
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
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
}: {
  say: string | null;
  heard: string | null;
  notice: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  onToggleTalk: () => void;
  onStart: () => void;
  thinking: boolean;
}) {
  return (
    <div className={styles.attract}>
      <img className={styles.logo} src="/brand/futureino-logo-trimmed.png" alt="Futureino" />
      <h1 className={styles.welcome}>Welcome</h1>
      <div className={styles.attractHero}>
        <Reply say={say} heard={heard} />
        {notice ? <p className={styles.notice}>{notice}</p> : null}
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} circle startLabel={"Tap to\nstart"} />
        <p className={styles.attractHint}>Say Hey Future to start</p>
        <button type="button" className={styles.attractBrowse} onClick={onStart} disabled={thinking}>
          Or browse machines
        </button>
      </div>
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
}: {
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  onToggleTalk: () => void;
  onBack: () => void;
  onStart: (machineId: MachineId) => void;
  thinking: boolean;
}) {
  useEffect(() => {
    if (!heard) return;
    if (/^\s*(go\s+)?back[.!?]?\s*$/i.test(heard)) onBack();
  }, [heard, onBack]);

  const live = talkPhase !== "off" || speaking || Boolean(heard) || Boolean(say);
  const art: Record<MachineId, string> = {
    coffee: "/images/coffee/coffee-01.webp",
    snacks: "/images/snacks/snacks-01.webp",
  };
  const sayWord: Record<MachineId, string> = { coffee: "Coffee", snacks: "Snacks" };

  return (
    <div className={styles.choose}>
      <div className={styles.chooseHead}>
        <h1 className={styles.chooseTitle}>What are you after?</h1>
        <div className={styles.voiceRow} data-live={live || undefined}>
          <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} mic />
          <div className={styles.voiceTranscript} role="status">
            {heard ? (
              <p className={styles.heard}>You said: “{heard}”</p>
            ) : say ? (
              <p className={styles.sayLine}>{say}</p>
            ) : talkPhase === "listening" ? (
              <p className={styles.voiceIdle}>Listening…</p>
            ) : talkPhase === "thinking" ? (
              <p className={styles.voiceIdle}>Thinking…</p>
            ) : speaking ? (
              <p className={styles.voiceIdle}>Speaking…</p>
            ) : (
              <p className={styles.voiceIdle}>Tap the mic, or say Coffee / Snacks</p>
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
              <span className={styles.machineBlurb}>{MACHINES[id].blurb}</span>
              <span className={styles.sayHint}>Say: {sayWord[id]}</span>
            </span>
          </button>
        ))}
      </div>
      <div className={styles.chooseFoot}>
        <button type="button" className={styles.backBtn} onClick={onBack} disabled={thinking}>
          Back
        </button>
        <p className={styles.orSay}>or Say: Back</p>
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
  onPick,
  onEditTemp,
  onQuantity,
  onSetTemp,
  onRemove,
  onReview,
  thinking,
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
  onPick: (productId: string) => void;
  onEditTemp: (lineId: string, productId: string) => void;
  onQuantity: (lineId: string, quantity: number) => void;
  onSetTemp: (lineId: string, temperature: Temperature) => void;
  onRemove: (lineId: string) => void;
  onReview: () => void;
  thinking: boolean;
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
    if (uiPulse.command === "open_cart") {
      setCartOpen(true);
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;
    const delta = Math.max(180, Math.floor(grid.clientHeight * 0.7));
    grid.scrollBy({ top: uiPulse.command === "scroll_down" ? delta : -delta, behavior: "smooth" });
  }, [uiPulse]);

  useEffect(() => {
    if (session.lines.length === 0) setCartOpen(false);
  }, [session.lines.length]);

  const total = cartTotal(session);
  const networkFail = notice?.includes("Couldn't reach the machine");

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
        <button type="button" className={styles.linkish} onClick={onCancel} disabled={thinking}>
          Start over
        </button>
      </header>
      <Reply say={say} heard={heard} />
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
          <p className={styles.empty}>Tap a product to add it.</p>
        ) : (
          <button
            type="button"
            className={styles.cartSummary}
            aria-expanded={cartOpen}
            onClick={() => setCartOpen((open) => !open)}
            disabled={thinking}
          >
            <span>
              {count} item{count === 1 ? "" : "s"} · {money(total)}
              {missing.size > 0 ? " · needs temp" : ""}
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
                      {TEMPS.find((temp) => temp.id === line.temperature)?.label}
                    </button>
                  ) : null}
                  {missing.has(line.lineId) ? (
                    <div className={styles.tempPick} role="group" aria-label={`Temperature for ${product?.name ?? "drink"}`}>
                      {TEMPS.map((temp) => (
                        <button
                          key={temp.id}
                          type="button"
                          onClick={() => onSetTemp(line.lineId, temp.id)}
                          disabled={thinking}
                        >
                          {temp.label}
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
                      Remove
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
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} compact />
        {typeOpen ? (
          <Composer onSend={onSend} disabled={thinking} onClose={() => setTypeOpen(false)} />
        ) : (
          <button
            type="button"
            className={styles.typeInstead}
            onClick={() => setTypeOpen(true)}
            disabled={thinking}
          >
            Type instead
          </button>
        )}
        <button
          type="button"
          className={styles.primary}
          onClick={onReview}
          disabled={thinking || count === 0 || missing.size > 0}
        >
          {count === 0 ? "Review order" : `Review order · ${money(total)}`}
        </button>
      </footer>
    </>
  );
}

function ProductSheet({
  item,
  lineId,
  session,
  busy,
  onClose,
  onAdd,
}: {
  item: CatalogItem;
  lineId?: string;
  session: OrderSession;
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
        <p className={styles.note}>Allergens: unknown. This machine has no ingredient list.</p>
        {needsTemp ? (
          <div className={styles.temps} role="group" aria-label="Temperature">
            {TEMPS.map((temp) => (
              <button
                key={temp.id}
                type="button"
                className={temperature === temp.id ? `${styles.temp} ${styles.tempOn}` : styles.temp}
                aria-pressed={temperature === temp.id}
                onClick={() => setTemperature(temp.id)}
                disabled={busy}
              >
                <strong>{temp.label}</strong>
                <small>{temp.hint}</small>
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
          {lineId ? "Save temperature" : `Add to order · ${money(item.priceCents)}`}
        </button>
        <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
          Close
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
  thinking,
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
  thinking: boolean;
}) {
  const networkFail = notice?.includes("Couldn't reach the machine");
  return (
    <div className={styles.review}>
      <div>
        <p className={styles.kicker}>Check this order</p>
        <h1 className={styles.title}>Add anything else, or confirm?</h1>
        <Reply say={say} heard={heard} />
        <ul className={styles.reviewList}>
          {readBack.lines.map((line) => (
            <li key={line.lineId}>
              <span>
                <strong>
                  {line.name}
                  {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                </strong>
                <span className={styles.meta}>
                  {line.temperature ? ` ${TEMPS.find((temp) => temp.id === line.temperature)?.label}` : ""}
                </span>
              </span>
              <span className={styles.price}>{money(line.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <p className={styles.total}>
          <span>Total</span>
          <span>{money(readBack.totalCents)}</span>
        </p>
      </div>
      <div className={styles.stack}>
        {notice ? (
          <p className={networkFail ? `${styles.notice} ${styles.noticeFail}` : styles.notice} role="status">
            {notice}
          </p>
        ) : null}
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} />
        <Composer onSend={onSend} disabled={thinking} modest />
        <button type="button" className={styles.primary} onClick={onConfirm} disabled={thinking}>
          Confirm order
        </button>
        <button type="button" className={styles.ghost} onClick={onChange} disabled={thinking}>
          Change order
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
  onNew,
  thinking,
}: {
  readBack: ReadBack;
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  onToggleTalk: () => void;
  onSend: (text: string) => void;
  onChange: () => void;
  onNew: () => void;
  thinking: boolean;
}) {
  return (
    <div className={styles.pay}>
      <div>
        <p className={styles.kicker}>Ready to pay</p>
        <h1 className={styles.title}>Pay at the terminal</h1>
        <p className={styles.payTotal}>{money(readBack.totalCents)}</p>
        <p className={styles.summary}>This demo stops here. Nothing is charged.</p>
        <Reply say={say} heard={heard} />
        <ul className={styles.reviewList}>
          {readBack.lines.map((line) => (
            <li key={line.lineId}>
              <span>
                {line.name}
                {line.temperature ? ` · ${TEMPS.find((temp) => temp.id === line.temperature)?.label}` : ""}
                {line.quantity > 1 ? ` × ${line.quantity}` : ""}
              </span>
              <span className={styles.price}>{money(line.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.stack}>
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} />
        <Composer onSend={onSend} disabled={thinking} modest />
        <button type="button" className={styles.ghost} onClick={onChange} disabled={thinking}>
          Change order
        </button>
        <button type="button" className={styles.primary} onClick={onNew} disabled={thinking}>
          New order
        </button>
      </div>
    </div>
  );
}

function Reply({ say, heard }: { say: string | null; heard: string | null }) {
  if (!say && !heard) return null;
  return (
    <div className={styles.say} role="status">
      {heard ? <p className={styles.heard}>You said: {heard}</p> : null}
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
  onMiss: (text: string) => void;
  onSilent: () => void;
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
      optsRef.current.onMiss("The microphone is blocked. Allow it and tap Talk again.");
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
      const blob = await captureUtterance(stream, () => live.current, meter);
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
}: {
  phase: TalkPhase;
  speaking: boolean;
  onToggle: () => void;
  hero?: boolean;
  compact?: boolean;
  circle?: boolean;
  mic?: boolean;
  startLabel?: string;
}) {
  const live = phase !== "off";
  const mode = !live ? "off" : speaking ? "speaking" : phase === "thinking" ? "thinking" : "listening";
  const idle = startLabel ?? "Talk";
  const label =
    mode === "off"
      ? idle
      : mode === "speaking"
        ? circle || mic
          ? "Speaking…"
          : "Speaking… tap to end"
        : mode === "thinking"
          ? circle || mic
            ? "Thinking…"
            : "Thinking… tap to end"
          : circle || mic
            ? "Listening…"
            : "Listening… tap to end";
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

/** Record until the customer pauses. Returns null when the pause had no speech. */
function captureUtterance(
  stream: MediaStream,
  live: () => boolean,
  context: AudioContext,
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
  source.connect(analyser);
  const bins = new Uint8Array(analyser.fftSize);
  recorder.start(200);

  return new Promise((resolve) => {
    const started = Date.now();
    let heardAt: number | null = null;
    let lastVoice = 0;
    const timer = window.setInterval(() => {
      if (!live() || recorder.state === "inactive") {
        window.clearInterval(timer);
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
      if (level >= 0.02) {
        if (heardAt === null) heardAt = now;
        lastVoice = now;
      }
      const spoke = heardAt !== null && now - heardAt > 280;
      const paused = spoke && now - lastVoice > 800;
      const tooLong = spoke && now - started > 12_000;
      const nobody = heardAt === null && now - started > 6_000;
      if (paused || tooLong || nobody) {
        window.clearInterval(timer);
        finish(!nobody);
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
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  modest?: boolean;
  onClose?: () => void;
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
        aria-label="Type your order"
        placeholder={modest ? "Or type here" : "Type your order"}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className={styles.send} disabled={disabled}>
        Send
      </button>
      {onClose ? (
        <button type="button" className={styles.composerClose} onClick={onClose} aria-label="Hide typing">
          ✕
        </button>
      ) : null}
    </form>
  );
}

function cartTotal(session: OrderSession): number {
  return session.lines.reduce((sum, line) => sum + (getItem(line.productId)?.priceCents ?? 0) * line.quantity, 0);
}
