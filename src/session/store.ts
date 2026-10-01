import type { MachineId } from "../catalog/index";
import { answerWithRules, type TurnResult } from "../agent/rules";
import { takeTurn } from "../agent/turn";
import {
  apply,
  createSession,
  type OrderInput,
  type OrderSession,
  type ReadBack,
  type RejectReason,
} from "../order/engine";

export type SessionResponse = {
  session: OrderSession;
  readBack: ReadBack | null;
  say: string | null;
  notice: string | null;
  spotlightIds: string[];
};

type Held = {
  session: OrderSession;
  readBack: ReadBack | null;
  say: string | null;
  notice: string | null;
  spotlightIds: string[];
};

const sessions = new Map<string, Held>();
const tails = new Map<string, Promise<void>>();

const NOTICES: Record<RejectReason, string> = {
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

export function openSession(machineId: MachineId, now = Date.now()): SessionResponse {
  const session = createSession({ id: crypto.randomUUID(), machineId, now });
  const held: Held = { session, readBack: null, say: null, notice: null, spotlightIds: [] };
  sessions.set(session.id, held);
  return snapshot(held);
}

export async function commandSession(id: string, command: OrderInput, now = Date.now()): Promise<SessionResponse | null> {
  return enqueue(id, (held) => {
    const result = apply(held.session, { ...command, now });
    held.session = result.session;
    held.say = null;
    held.spotlightIds = [];
    held.notice = result.ok ? null : NOTICES[result.reason ?? "cart_empty"];
    if (result.readBack && (result.session.phase === "awaiting_confirmation" || result.session.phase === "ready_to_pay")) {
      held.readBack = result.readBack;
    }
    if (result.session.phase === "browsing" || result.session.phase === "drafting" || result.session.phase === "abandoned") {
      held.readBack = null;
    }
    return snapshot(held);
  });
}

export async function messageSession(id: string, text: string, now = Date.now()): Promise<SessionResponse | null> {
  return enqueue(id, async (held) => {
    const turn = await takeTurn(held.session, text, now);
    remember(held, turn);
    return snapshot(held);
  });
}

/** Rules-only turn for tests. Does not call a model. */
export function messageWithRules(session: OrderSession, text: string, now: number): TurnResult {
  return answerWithRules(session, text, now);
}

function remember(held: Held, turn: TurnResult) {
  held.session = turn.session;
  held.say = turn.say;
  held.notice = null;
  held.spotlightIds = turn.spotlightIds;
  held.readBack = turn.readBack;
}

function snapshot(held: Held): SessionResponse {
  return {
    session: held.session,
    readBack: held.readBack,
    say: held.say,
    notice: held.notice,
    spotlightIds: held.spotlightIds,
  };
}

function enqueue<T>(id: string, fn: (held: Held) => T | Promise<T>): Promise<T | null> {
  const previous = tails.get(id) ?? Promise.resolve();
  const run = previous.then(async () => {
    const held = sessions.get(id);
    if (!held) return null;
    return fn(held);
  });
  tails.set(
    id,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
