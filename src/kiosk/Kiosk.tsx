"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  getItem,
  itemsForMachine,
  MACHINES,
  type CatalogItem,
  type MachineId,
  type Temperature,
} from "../catalog/index";
import {
  apply,
  createSession,
  type OrderInput,
  type OrderSession,
  type ReadBack,
  type RejectReason,
} from "../order/engine";
import styles from "./kiosk.module.css";

type Stage = "attract" | "machines";
type Picker = { productId: string; lineId?: string };

const TEMPS: { id: Temperature; label: string; hint: string }[] = [
  { id: "hot", label: "Hot", hint: "Steaming" },
  { id: "iced", label: "Iced", hint: "Over ice" },
  { id: "room", label: "Room", hint: "No heat" },
];

const REASONS: Record<RejectReason, string> = {
  session_abandoned: "This order was cleared.",
  unknown_product: "That item is not on this machine.",
  wrong_machine: "That item is not on this machine.",
  invalid_quantity: "Choose a quantity from 1 to 9.",
  invalid_temperature: "Choose hot, iced, or room.",
  temperature_not_allowed: "Snacks do not take a temperature.",
  unknown_line: "That line is no longer in the cart.",
  cart_empty: "Add something first.",
  incomplete: "Choose hot, iced, or room temperature first.",
  not_awaiting_confirmation: "Review the order before confirming.",
  stale_cart: "That order changed. Review it again.",
};

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function Kiosk() {
  const [stage, setStage] = useState<Stage>("attract");
  const [session, setSession] = useState<OrderSession | null>(null);
  const [readBack, setReadBack] = useState<ReadBack | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session || session.phase === "abandoned") return;
    const timer = window.setInterval(() => {
      setSession((current) => {
        if (!current || current.phase === "abandoned") return current;
        const next = apply(current, { type: "tick", now: Date.now() }).session;
        return next === current ? current : next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.phase]);

  useEffect(() => {
    if (session?.phase !== "abandoned") return;
    setSession(null);
    setStage("attract");
    setReadBack(null);
    setPicker(null);
    setNotice(null);
  }, [session]);

  function run(current: OrderSession, command: OrderInput) {
    const result = apply(current, { ...command, now: Date.now() });
    setSession(result.session);
    setNotice(result.ok ? null : REASONS[result.reason ?? "cart_empty"]);
    if (result.readBack) setReadBack(result.readBack);
    if (command.type === "revise") setReadBack(null);
    return result;
  }

  function start(machineId: MachineId) {
    setSession(createSession({ id: crypto.randomUUID(), machineId, now: Date.now() }));
    setReadBack(null);
    setPicker(null);
    setNotice(null);
    setStage("attract");
  }

  function cancel() {
    if (!session || session.phase === "abandoned") {
      setSession(null);
      setStage("attract");
      return;
    }
    run(session, { type: "cancel" });
  }

  const ended = !session || session.phase === "abandoned";
  const item = picker ? getItem(picker.productId) : undefined;

  let body: ReactNode;
  if (ended) {
    body =
      stage === "machines" ? (
        <MachineChoice onBack={() => setStage("attract")} onStart={start} />
      ) : (
        <Attract onStart={() => setStage("machines")} />
      );
  } else if (session.phase === "ready_to_pay" && readBack) {
    body = (
      <Pay
        readBack={readBack}
        onChange={() => run(session, { type: "revise" })}
        onNew={cancel}
      />
    );
  } else if (session.phase === "awaiting_confirmation" && readBack) {
    body = (
      <Review
        readBack={readBack}
        notice={notice}
        onConfirm={() =>
          run(session, {
            type: "confirm",
            cartVersion: readBack.cartVersion,
            source: "confirm_tap",
          })
        }
        onChange={() => run(session, { type: "revise" })}
      />
    );
  } else {
    body = (
      <Menu
        session={session}
        notice={notice}
        onCancel={cancel}
        onPick={(productId) => setPicker({ productId })}
        onEditTemp={(lineId, productId) => setPicker({ lineId, productId })}
        onQuantity={(lineId, quantity) => run(session, { type: "set_quantity", lineId, quantity })}
        onRemove={(lineId) => run(session, { type: "remove_line", lineId })}
        onReview={() => run(session, { type: "read_back" })}
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
              run(session, { type: "activity" });
              setPicker(null);
            }}
            onAdd={(temperature) => {
              if (picker?.lineId) {
                if (!temperature) return;
                const saved = run(session, {
                  type: "set_temperature",
                  lineId: picker.lineId,
                  temperature,
                });
                if (saved.ok) setPicker(null);
                return;
              }
              const added = run(session, {
                type: "add",
                productId: item.id,
                ...(temperature ? { temperature } : {}),
              });
              if (added.ok) setPicker(null);
            }}
          />
        ) : null}
        {session && session.idlePrompted && session.phase !== "abandoned" ? (
          <div className={styles.idle} role="dialog" aria-labelledby="idle-title">
            <div className={styles.idleCard}>
              <h2 id="idle-title">Still there?</h2>
              <p className={styles.summary}>The order will clear if nobody is at the machine.</p>
              <button type="button" className={styles.primary} onClick={() => run(session, { type: "activity" })}>
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

function Attract({ onStart }: { onStart: () => void }) {
  return (
    <div className={styles.attract}>
      <img className={styles.logo} src="/brand/futureino-logo-trimmed.png" alt="Futureino" />
      <div className={styles.stack}>
        <p className={styles.attractCopy}>Boost Coffee and Snacks Bot</p>
        <button type="button" className={styles.primary} onClick={onStart}>
          Tap to start
        </button>
      </div>
    </div>
  );
}

function MachineChoice({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (machineId: MachineId) => void;
}) {
  return (
    <div className={styles.choose}>
      <div>
        <p className={styles.kicker}>Choose a machine</p>
        <h1 className={styles.title}>What are you at?</h1>
      </div>
      <div className={styles.stack}>
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
  notice,
  onCancel,
  onPick,
  onEditTemp,
  onQuantity,
  onRemove,
  onReview,
}: {
  session: OrderSession;
  notice: string | null;
  onCancel: () => void;
  onPick: (productId: string) => void;
  onEditTemp: (lineId: string, productId: string) => void;
  onQuantity: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
  onReview: () => void;
}) {
  const products = itemsForMachine(session.machineId);
  const missing = new Set(
    session.lines.filter((line) => getItem(line.productId)?.requiresTemperature && !line.temperature).map((line) => line.lineId),
  );
  const count = session.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <>
      <header className={styles.topbar}>
        <div>
          <p>Futureino</p>
          <h2>{MACHINES[session.machineId].name}</h2>
        </div>
        <button type="button" className={styles.linkish} onClick={onCancel}>
          Start over
        </button>
      </header>
      <div className={styles.grid}>
        {products.map((product) => (
          <button key={product.id} type="button" className={styles.card} onClick={() => onPick(product.id)}>
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
                <span className={styles.meta}>
                  {line.temperature ? TEMPS.find((temp) => temp.id === line.temperature)?.label : product?.summary}
                </span>
                {missing.has(line.lineId) ? (
                  <button type="button" className={styles.needed} onClick={() => onEditTemp(line.lineId, line.productId)}>
                    Choose temperature
                  </button>
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
        <button type="button" className={styles.primary} onClick={onReview} disabled={count === 0 || missing.size > 0}>
          {missing.size > 0 ? "Choose a temperature" : count === 0 ? "Review order" : `Review order · ${money(cartTotal(session))}`}
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
  onConfirm,
  onChange,
}: {
  readBack: ReadBack;
  notice: string | null;
  onConfirm: () => void;
  onChange: () => void;
}) {
  return (
    <div className={styles.review}>
      <div>
        <p className={styles.kicker}>Check this order</p>
        <h1 className={styles.title}>Is this right?</h1>
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
  onChange,
  onNew,
}: {
  readBack: ReadBack;
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

function cartTotal(session: OrderSession): number {
  return session.lines.reduce((sum, line) => sum + (getItem(line.productId)?.priceCents ?? 0) * line.quantity, 0);
}
