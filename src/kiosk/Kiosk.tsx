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
  const requestSeq = useRef(0);
  const liveSessionId = useRef<string | null>(null);
  const seenActivity = useRef(0);
  const seenCart = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const voice = useRef<AudioBufferSourceNode | null>(null);
  const speakingNow = useRef(false);

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

  function armAudio() {
    const context = audioContext();
    void context.resume();
  }

  async function play(base64: string) {
    stopPlayback();
    speakingNow.current = true;
    setSpeaking(true);
    try {
      const context = audioContext();
      await context.resume();
      const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(binary.buffer.slice(0));
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
    const response = await fetch(url, {
      method: "POST",
      headers: isAudio ? undefined : { "content-type": "application/json" },
      body: isAudio ? body : JSON.stringify(body),
    });
    if (!response.ok) {
      if (!tick && mine === requestSeq.current) setNotice("The machine missed that. Try again.");
      return null;
    }
    const state = (await response.json()) as ServerState;
    if (mine !== requestSeq.current) return state;
    const nextSession = state.session;
    if (nextSession && !isNewerSession(nextSession, tick)) return state;
    if (state.switchTo) {
      setMenu(state.switchTo);
      setShowMenu(true);
    } else if (!tick && state.readBack && (nextSession?.phase === "awaiting_confirmation" || nextSession?.phase === "ready_to_pay")) {
      setShowMenu(false);
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

  function sendClip(blob: Blob) {
    setPicker(null);
    const body = new FormData();
    const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
    body.append("audio", blob, `talk.${ext}`);
    if (!session) return post("/api/arrive", body);
    return post(`/api/sessions/${session.id}/speech`, body);
  }

  const talk = useConversation({
    enabled: session === null || session.phase !== "abandoned",
    onClip: sendClip,
    onArm: armAudio,
    onStop: stopPlayback,
    onMiss: setNotice,
    isSpeaking: () => speakingNow.current,
  });

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
          onToggleTalk={talk.toggle}
          onBack={() => setStage("attract")}
          onStart={start}
        />
      ) : (
        <Attract
          say={say}
          heard={heard}
          speaking={speaking}
          talkPhase={talk.phase}
          onToggleTalk={talk.toggle}
          onStart={() => setStage("machines")}
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
        onToggleTalk={talk.toggle}
        onSend={send}
        onChange={() => void run({ type: "revise" })}
        onNew={cancel}
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
        onToggleTalk={talk.toggle}
        onSend={send}
        onConfirm={() =>
          void run({
            type: "confirm",
            cartVersion: readBack.cartVersion,
            source: "confirm_tap",
          })
        }
        onChange={() => void run({ type: "revise" })}
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
        onToggleTalk={talk.toggle}
        spotlightIds={spotlightIds}
        onSend={send}
        onCancel={cancel}
        onPick={(productId) => setPicker({ productId })}
        onEditTemp={(lineId, productId) => setPicker({ lineId, productId })}
        onQuantity={(lineId, quantity) => void run({ type: "set_quantity", lineId, quantity })}
        onSetTemp={(lineId, temperature) => void run({ type: "set_temperature", lineId, temperature })}
        onRemove={(lineId) => void run({ type: "remove_line", lineId })}
        onReview={() => void run({ type: "read_back" })}
      />
    );
  }

  return (
    <main className={styles.frame}>
      <section className={styles.screen} aria-label="Vending machine">
        {body}
        {item && session && session.phase !== "abandoned" && session.phase !== "ready_to_pay" ? (
          <ProductSheet
            item={item}
            lineId={picker?.lineId}
            session={session}
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
              <h2 id="idle-title">Still there?</h2>
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
  speaking,
  talkPhase,
  onToggleTalk,
  onStart,
}: {
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  onToggleTalk: () => void;
  onStart: () => void;
}) {
  return (
    <div className={styles.attract}>
      <img className={styles.logo} src="/brand/futureino-logo-trimmed.png" alt="Futureino" />
      <div className={styles.stack}>
        <p className={styles.attractCopy}>Boost Coffee and Snacks Bot</p>
        <Reply say={say} heard={heard} />
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} />
        <button type="button" className={styles.primary} onClick={onStart}>
          Tap to start
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
}: {
  say: string | null;
  heard: string | null;
  speaking: boolean;
  talkPhase: TalkPhase;
  onToggleTalk: () => void;
  onBack: () => void;
  onStart: (machineId: MachineId) => void;
}) {
  return (
    <div className={styles.choose}>
      <div>
        <p className={styles.kicker}>Choose a machine</p>
        <h1 className={styles.title}>What are you at?</h1>
        <Reply say={say} heard={heard} />
      </div>
      <div className={styles.stack}>
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} />
        {(Object.keys(MACHINES) as MachineId[]).map((id) => (
          <button key={id} type="button" className={styles.machine} onClick={() => onStart(id)}>
            <strong>{MACHINES[id].name}</strong>
            <span>{MACHINES[id].blurb}</span>
          </button>
        ))}
        <button type="button" className={styles.ghost} onClick={onBack}>
          Back
        </button>
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
  onSend,
  onCancel,
  onPick,
  onEditTemp,
  onQuantity,
  onSetTemp,
  onRemove,
  onReview,
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
  onSend: (text: string) => void;
  onCancel: () => void;
  onPick: (productId: string) => void;
  onEditTemp: (lineId: string, productId: string) => void;
  onQuantity: (lineId: string, quantity: number) => void;
  onSetTemp: (lineId: string, temperature: Temperature) => void;
  onRemove: (lineId: string) => void;
  onReview: () => void;
}) {
  const products = itemsForMachine(menu);
  const missing = new Set(
    session.lines.filter((line) => getItem(line.productId)?.requiresTemperature && !line.temperature).map((line) => line.lineId),
  );
  const count = session.lines.reduce((sum, line) => sum + line.quantity, 0);

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
              >
                {MACHINES[id].name}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className={styles.linkish} onClick={onCancel}>
          Start over
        </button>
      </header>
      <Reply say={say} heard={heard} />
      <div className={styles.grid}>
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            className={spotlightIds.includes(product.id) ? `${styles.card} ${styles.spot}` : styles.card}
            onClick={() => onPick(product.id)}
          >
            <img src={`/${product.imagePath}`} alt="" />
            <span className={styles.cardName}>{product.name}</span>
            <span className={styles.cardPrice}>{money(product.priceCents)}</span>
          </button>
        ))}
      </div>
      <footer className={styles.dock} aria-label="Cart">
        {session.lines.length === 0 ? <p className={styles.empty}>Tap a product to add it.</p> : null}
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
                  >
                    {TEMPS.find((temp) => temp.id === line.temperature)?.label}
                  </button>
                ) : null}
                {missing.has(line.lineId) ? (
                  <div className={styles.tempPick} role="group" aria-label={`Temperature for ${product?.name ?? "drink"}`}>
                    {TEMPS.map((temp) => (
                      <button key={temp.id} type="button" onClick={() => onSetTemp(line.lineId, temp.id)}>
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
                    disabled={line.quantity <= 1}
                  >
                    −
                  </button>
                  <span>{line.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Increase ${product?.name ?? "item"}`}
                    onClick={() => onQuantity(line.lineId, line.quantity + 1)}
                    disabled={line.quantity >= 9}
                  >
                    +
                  </button>
                  <button type="button" className={styles.remove} onClick={() => onRemove(line.lineId)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} />
        <Composer onSend={onSend} />
        <button type="button" className={styles.primary} onClick={onReview} disabled={count === 0 || missing.size > 0}>
          {count === 0 ? "Review order" : `Review order · ${money(cartTotal(session))}`}
        </button>
      </footer>
    </>
  );
}

function ProductSheet({
  item,
  lineId,
  session,
  onClose,
  onAdd,
}: {
  item: CatalogItem;
  lineId?: string;
  session: OrderSession;
  onClose: () => void;
  onAdd: (temperature?: Temperature) => void;
}) {
  const existing = lineId ? session.lines.find((line) => line.lineId === lineId) : undefined;
  const [temperature, setTemperature] = useState<Temperature | undefined>(existing?.temperature);
  const needsTemp = item.requiresTemperature;
  const blocked = needsTemp && !temperature;

  return (
    <div className={styles.backdrop} onClick={onClose}>
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
              >
                <strong>{temp.label}</strong>
                <small>{temp.hint}</small>
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className={styles.primary} disabled={blocked} onClick={() => onAdd(temperature)}>
          {lineId ? "Save temperature" : `Add to order · ${money(item.priceCents)}`}
        </button>
        <button type="button" className={styles.ghost} onClick={onClose}>
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
}) {
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
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
        <Talk phase={talkPhase} speaking={speaking} onToggle={onToggleTalk} />
        <Composer onSend={onSend} />
        <button type="button" className={styles.primary} onClick={onConfirm}>
          Confirm order
        </button>
        <button type="button" className={styles.ghost} onClick={onChange}>
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
        <Composer onSend={onSend} />
        <button type="button" className={styles.ghost} onClick={onChange}>
          Change order
        </button>
        <button type="button" className={styles.primary} onClick={onNew}>
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
  onClip: (blob: Blob) => Promise<unknown>;
  onArm: () => void;
  onStop: () => void;
  onMiss: (text: string) => void;
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

  async function loop() {
    optsRef.current.onArm();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      live.current = false;
      setPhase("off");
      optsRef.current.onMiss("The microphone is blocked. Allow it and tap Talk again.");
      return;
    }
    if (!live.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    while (live.current) {
      setPhase("listening");
      const blob = await captureUtterance(stream, () => live.current);
      if (!live.current) break;
      if (!blob) continue;
      setPhase("thinking");
      await optsRef.current.onClip(blob);
      while (live.current && optsRef.current.isSpeaking()) {
        await wait(80);
      }
    }
    stream.getTracks().forEach((track) => track.stop());
    if (streamRef.current === stream) streamRef.current = null;
    if (!live.current) setPhase("off");
  }

  function toggle() {
    if (live.current) {
      end();
      return;
    }
    live.current = true;
    setPhase("listening");
    void loop();
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

  return { phase, toggle };
}

function Talk({ phase, speaking, onToggle }: { phase: TalkPhase; speaking: boolean; onToggle: () => void }) {
  const live = phase !== "off";
  const label = !live ? "Talk" : speaking ? "Speaking… tap to end" : phase === "thinking" ? "One moment… tap to end" : "Listening… tap to end";
  return (
    <button
      type="button"
      className={live ? `${styles.talk} ${styles.talkLive}` : styles.talk}
      aria-pressed={live}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Record until the customer pauses. Returns null when the pause had no speech. */
function captureUtterance(stream: MediaStream, live: () => boolean): Promise<Blob | null> {
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const context = new AudioContext();
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
      if (paused || tooLong) {
        window.clearInterval(timer);
        finish(true);
      }
    }, 50);

    function finish(send: boolean) {
      const done = () => {
        source.disconnect();
        void context.close();
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        resolve(send && blob.size >= 500 ? blob : null);
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

function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        const value = text.trim();
        if (!value) return;
        setText("");
        onSend(value);
      }}
    >
      <input
        aria-label="Type your order"
        placeholder="Type your order"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className={styles.send}>
        Send
      </button>
    </form>
  );
}

function cartTotal(session: OrderSession): number {
  return session.lines.reduce((sum, line) => sum + (getItem(line.productId)?.priceCents ?? 0) * line.quantity, 0);
}
