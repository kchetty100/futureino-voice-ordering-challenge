import { machineIntro, machineForUtterance, requestedMachine } from "../agent/arrive";
import { getItem, type MachineId } from "../catalog/index";
import { beginLobby, beginRecord, duringSession, loadRecord, recordState, recordTurn, saveRecord } from "../operator/log";
import { sharedGet, sharedSet, sharedStoreConfigured } from "../persist/remote";
import { answerWithRules, type TurnResult, type UiCommand } from "../agent/rules";
import { takeTurn } from "../agent/turn";
import {
  apply,
  createSession,
  type OrderInput,
  type OrderSession,
  type ReadBack,
  type RejectReason,
} from "../order/engine";
import {
  applyLanguageCue,
  langOf,
  languageFromSttLabel,
  t,
  type AppLanguage,
} from "../i18n";

export type SessionResponse = {
  session: OrderSession | null;
  readBack: ReadBack | null;
  say: string | null;
  notice: string | null;
  spotlightIds: string[];
  switchTo: MachineId | null;
  ui: UiCommand | null;
};

export type ArriveResult = SessionResponse & { logId: string };

type Held = {
  session: OrderSession;
  readBack: ReadBack | null;
  say: string | null;
  notice: string | null;
  spotlightIds: string[];
};

const scope = globalThis as unknown as {
  futureinoSessions?: Map<string, Held>;
  futureinoTails?: Map<string, Promise<void>>;
};
const sessions = scope.futureinoSessions ?? new Map<string, Held>();
scope.futureinoSessions = sessions;
const tails = scope.futureinoTails ?? new Map<string, Promise<void>>();
scope.futureinoTails = tails;

function noticeFor(session: OrderSession, reason: RejectReason): string {
  // Touch notices stay short; share the same translated reject keys when available.
  const key = reason === "cart_empty" ? "cart_empty" : reason;
  return t(langOf(session), key);
}

export async function sessionMachine(id: string): Promise<MachineId | null> {
  const held = await recallSession(id);
  return held?.session.machineId ?? null;
}

export async function recallLanguage(
  id: string,
): Promise<{ preferredLanguage: AppLanguage; languageSet: boolean } | null> {
  const held = await recallSession(id);
  if (!held) return null;
  return {
    preferredLanguage: held.session.preferredLanguage,
    languageSet: held.session.languageSet,
  };
}

export function forgetLocalSessions() {
  sessions.clear();
}

/** First screen. Opens the machine the customer named, or asks them to choose. */
export async function arriveSession(
  text: string,
  now = Date.now(),
  source: "text" | "voice" = "text",
  sttLanguageLabel?: string | null,
  pinnedLanguage?: AppLanguage | null,
): Promise<ArriveResult> {
  const seed = seedLanguage(text, sttLanguageLabel, pinnedLanguage);
  const machineId = machineForUtterance(text);
  if (!machineId) {
    const logId = beginLobby(now);
    const say = t(seed.preferredLanguage, "choose_machine");
    recordTurn(logId, { at: now, source, customer: text, say });
    await saveRecord(logId);
    return {
      session: null,
      readBack: null,
      say,
      notice: null,
      spotlightIds: [],
      switchTo: null,
      ui: null,
      logId,
    };
  }
  const opened = await openSession(machineId, now, seed);
  const logId = opened.session?.id ?? beginLobby(now);
  if (!opened.session) {
    await saveRecord(logId);
    return { ...opened, logId };
  }
  if (requestedMachine(text) === machineId) {
    const intro = machineIntro(machineId, langOf(opened.session));
    recordTurn(logId, { at: now, source, customer: text, say: intro.say });
    await saveRecord(logId);
    return { ...opened, say: intro.say, spotlightIds: intro.spotlightIds, logId };
  }
  const continued = await messageSession(opened.session.id, text, now, source, sttLanguageLabel);
  return { ...(continued ?? opened), logId };
}

function seedLanguage(
  text: string,
  sttLanguageLabel?: string | null,
  pinnedLanguage?: AppLanguage | null,
): { preferredLanguage: AppLanguage; languageSet: boolean } {
  if (pinnedLanguage) return { preferredLanguage: pinnedLanguage, languageSet: true };
  const fromStt = languageFromSttLabel(sttLanguageLabel);
  const { fields } = applyLanguageCue(
    {
      preferredLanguage: fromStt ?? "en",
      languageSet: Boolean(fromStt && fromStt !== "en"),
    },
    text,
  );
  // If STT named a supported language and text didn't override, keep it.
  if (!fields.languageSet && fromStt) {
    return { preferredLanguage: fromStt, languageSet: true };
  }
  return fields;
}

export async function openSession(
  machineId: MachineId,
  now = Date.now(),
  language?: { preferredLanguage: AppLanguage; languageSet: boolean },
): Promise<SessionResponse> {
  const session = createSession({
    id: crypto.randomUUID(),
    machineId,
    now,
    preferredLanguage: language?.preferredLanguage,
    languageSet: language?.languageSet,
  });
  const held: Held = { session, readBack: null, say: null, notice: null, spotlightIds: [] };
  sessions.set(session.id, held);
  beginRecord(session, now);
  await rememberSession(session.id);
  await saveRecord(session.id);
  return snapshot(held);
}

/** The welcome-screen language button. Later speech uses this until they ask to switch. */
export async function assignLanguage(id: string, language: AppLanguage, now = Date.now()): Promise<SessionResponse | null> {
  return enqueue(id, (held) => {
    if (held.session.languageSet && held.session.preferredLanguage === language) return snapshot(held);
    held.session = { ...held.session, preferredLanguage: language, languageSet: true };
    recordTurn(id, { at: now, source: "touch", customer: `Language ${language}`, say: null });
    recordState(id, held.session, now);
    return snapshot(held);
  });
}

export async function commandSession(id: string, command: OrderInput, now = Date.now()): Promise<SessionResponse | null> {
  return enqueue(id, (held) => {
    const before = held.session;
    const result = apply(held.session, { ...command, now });
    held.session = result.session;
    held.say = null;
    held.spotlightIds = [];
    held.notice = result.ok ? null : noticeFor(held.session, result.reason ?? "cart_empty");
    if (result.readBack && (result.session.phase === "awaiting_confirmation" || result.session.phase === "ready_to_pay")) {
      held.readBack = result.readBack;
    }
    if (result.session.phase === "browsing" || result.session.phase === "drafting" || result.session.phase === "abandoned") {
      held.readBack = null;
    }
    const label = touchLine(before, command);
    if (label) {
      recordTurn(id, {
        at: now,
        source: "touch",
        customer: label,
        say: result.ok ? null : noticeFor(result.session, result.reason ?? "cart_empty"),
      });
    }
    if (command.type === "tick" && before.phase !== "abandoned" && result.session.phase === "abandoned") {
      recordTurn(id, {
        at: now,
        source: "system",
        customer: null,
        say: t(langOf(before), "walked_away"),
      });
    }
    recordState(id, result.session, now);
    return snapshot(held);
  });
}

export async function messageSession(
  id: string,
  text: string,
  now = Date.now(),
  source: "text" | "voice" = "text",
  sttLanguageLabel?: string | null,
): Promise<SessionResponse | null> {
  return enqueue(id, async (held) => {
    if (!held.session.languageSet) {
      const fromStt = languageFromSttLabel(sttLanguageLabel);
      if (fromStt) {
        held.session = {
          ...held.session,
          preferredLanguage: fromStt,
          languageSet: true,
        };
      }
    }
    const turn = await duringSession(id, () => takeTurn(held.session, text, now));
    remember(held, turn);
    recordTurn(id, { at: now, source, customer: text, say: turn.say });
    recordState(id, turn.session, now);
    return snapshot(held, turn.switchTo, turn.ui);
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
  if (turn.readBack) {
    held.readBack = turn.readBack;
  } else if (
    turn.ui &&
    (turn.session.phase === "awaiting_confirmation" || turn.session.phase === "ready_to_pay")
  ) {
    // Keep the review/pay cart when the turn only moved the screen (cart/scroll).
  } else {
    held.readBack = turn.readBack;
  }
}

function snapshot(held: Held, switchTo: MachineId | null = null, ui: UiCommand | null = null): SessionResponse {
  return {
    session: held.session,
    readBack: held.readBack,
    say: held.say,
    notice: held.notice,
    spotlightIds: held.spotlightIds,
    switchTo,
    ui,
  };
}

function touchLine(session: OrderSession, command: OrderInput): string | null {
  switch (command.type) {
    case "add": {
      const name = getItem(command.productId)?.name ?? "an item";
      return command.temperature ? `Tapped ${name}, ${command.temperature}` : `Tapped ${name}`;
    }
    case "set_temperature": {
      const line = session.lines.find((item) => item.lineId === command.lineId);
      const name = line ? (getItem(line.productId)?.name ?? "that item") : "that item";
      return `Set ${name} to ${command.temperature}`;
    }
    case "set_quantity": {
      const line = session.lines.find((item) => item.lineId === command.lineId);
      const name = line ? (getItem(line.productId)?.name ?? "that item") : "that item";
      return `Set ${name} to ${command.quantity}`;
    }
    case "remove_line": {
      const line = session.lines.find((item) => item.lineId === command.lineId);
      const name = line ? (getItem(line.productId)?.name ?? "that item") : "that item";
      return `Removed ${name}`;
    }
    case "read_back":
      return "Opened the cart";
    case "confirm":
      return "Tapped confirm";
    case "revise":
      return "Tapped change order";
    case "cancel":
      return "Cancelled the order";
    case "clear":
      return "Cleared the cart";
    default:
      return null;
  }
}

function enqueue<T>(id: string, fn: (held: Held) => T | Promise<T>): Promise<T | null> {
  const previous = tails.get(id) ?? Promise.resolve();
  const run = previous.then(async () => {
    const held = await recallSession(id);
    if (!held) return null;
    await loadRecord(id);
    const result = await fn(held);
    await rememberSession(id);
    await saveRecord(id);
    return result;
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

async function recallSession(id: string): Promise<Held | null> {
  if (!sharedStoreConfigured()) return sessions.get(id) ?? null;
  const raw = await sharedGet(sessionKey(id));
  if (!raw) return null;
  try {
    const held = JSON.parse(raw) as Held;
    held.session = {
      ...held.session,
      preferredLanguage: held.session.preferredLanguage ?? "en",
      languageSet: held.session.languageSet ?? false,
    };
    sessions.set(id, held);
    return held;
  } catch {
    return null;
  }
}

async function rememberSession(id: string): Promise<void> {
  if (!sharedStoreConfigured()) return;
  const held = sessions.get(id);
  if (!held) return;
  await sharedSet(sessionKey(id), JSON.stringify(held));
}

function sessionKey(id: string): string {
  return `futureino:session:${id}`;
}
