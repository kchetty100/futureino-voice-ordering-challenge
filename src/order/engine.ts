import { getItem, TEMPERATURES, type MachineId, type Temperature } from "../catalog/index";
import type { AppLanguage } from "../i18n";

/**
 * The only writer of a cart. Voice and touch both send commands here.
 * A model may propose a product; it cannot mark an order ready to pay.
 *
 * Time is passed in. Silence does not count as activity. A tick does not
 * prompt or clear the cart. The kiosk ends a visit when the camera has
 * seen nobody, after a countdown.
 */

export const MAX_QUANTITY = 9;

export type Phase =
  | "browsing"
  | "drafting"
  | "awaiting_confirmation"
  | "ready_to_pay"
  | "abandoned";

export type ConfirmSource = "voice_yes" | "confirm_tap";

export type CartLine = {
  lineId: string;
  productId: string;
  quantity: number;
  temperature?: Temperature;
};

export type OrderSession = {
  id: string;
  machineId: MachineId;
  phase: Phase;
  lines: readonly CartLine[];
  cartVersion: number;
  /** Version last spoken back. Confirm must send this version. */
  readBackVersion: number | null;
  confirmedBy: ConfirmSource | null;
  nextLineNumber: number;
  createdAt: number;
  lastActivityAt: number;
  idlePrompted: boolean;
  /** Customer-facing reply language for say/TTS. Defaults to English until detected or chosen. */
  preferredLanguage: AppLanguage;
  /** Once true, only an explicit language choice may change preferredLanguage. */
  languageSet: boolean;
};

export type MissingField = {
  lineId: string;
  productId: string;
  field: "temperature";
};

export type ReadBackLine = {
  lineId: string;
  productId: string;
  name: string;
  quantity: number;
  temperature?: Temperature;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type ReadBack = {
  cartVersion: number;
  machineId: MachineId;
  lines: readonly ReadBackLine[];
  totalCents: number;
};

export type RejectReason =
  | "session_abandoned"
  | "unknown_product"
  | "wrong_machine"
  | "invalid_quantity"
  | "invalid_temperature"
  | "temperature_not_allowed"
  | "unknown_line"
  | "cart_empty"
  | "incomplete"
  | "not_awaiting_confirmation"
  | "stale_cart";

export type OrderInput =
  | { type: "add"; productId: string; quantity?: number; temperature?: Temperature }
  | { type: "set_temperature"; lineId: string; temperature: Temperature }
  | { type: "set_quantity"; lineId: string; quantity: number }
  | { type: "remove_line"; lineId: string }
  | { type: "read_back" }
  | { type: "confirm"; cartVersion: number; source: ConfirmSource }
  | { type: "revise" }
  | { type: "activity" }
  | { type: "cancel" }
  | { type: "clear" }
  | { type: "silence" }
  | { type: "tick" };

export type OrderCommand = OrderInput & { now: number };

export type ApplyResult = {
  session: OrderSession;
  ok: boolean;
  reason?: RejectReason;
  missing: readonly MissingField[];
  readBack?: ReadBack;
  /** True only on the tick that first asks if the customer is still there. */
  idlePrompt: boolean;
};

export function createSession(input: {
  id: string;
  machineId: MachineId;
  now: number;
  preferredLanguage?: AppLanguage;
  languageSet?: boolean;
}): OrderSession {
  if (input.machineId !== "coffee" && input.machineId !== "snacks") {
    throw new Error(`Unknown machine: ${input.machineId}`);
  }
  return {
    id: input.id,
    machineId: input.machineId,
    phase: "browsing",
    lines: [],
    cartVersion: 0,
    readBackVersion: null,
    confirmedBy: null,
    nextLineNumber: 1,
    createdAt: input.now,
    lastActivityAt: input.now,
    idlePrompted: false,
    preferredLanguage: input.preferredLanguage ?? "en",
    languageSet: input.languageSet ?? false,
  };
}

export function apply(session: OrderSession, command: OrderCommand): ApplyResult {
  if (session.phase === "abandoned") {
    if (command.type === "tick") {
      return ok(session);
    }
    return fail(session, "session_abandoned");
  }

  switch (command.type) {
    case "silence":
      return ok(session);
    case "tick":
      return applyTick(session, command.now);
    case "add":
      return applyAdd(session, command);
    case "set_temperature":
      return applySetTemperature(session, command);
    case "set_quantity":
      return applySetQuantity(session, command);
    case "remove_line":
      return applyRemove(session, command);
    case "read_back":
      return applyReadBack(session, command.now);
    case "confirm":
      return applyConfirm(session, command);
    case "revise":
      return applyRevise(session, command.now);
    case "activity":
      return ok(touch(session, command.now));
    case "cancel":
      return ok(abandon(touch(session, command.now)));
    case "clear":
      return applyClear(session, command.now);
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

function applyTick(session: OrderSession, _now: number): ApplyResult {
  return ok(session);
}

function applyAdd(
  session: OrderSession,
  command: Extract<OrderCommand, { type: "add" }>,
): ApplyResult {
  const item = getItem(command.productId);
  if (!item) {
    return fail(touch(session, command.now), "unknown_product");
  }

  const quantity = command.quantity ?? 1;
  if (!isQuantity(quantity)) {
    return fail(touch(session, command.now), "invalid_quantity");
  }
  if (command.temperature !== undefined && !item.requiresTemperature) {
    return fail(touch(session, command.now), "temperature_not_allowed");
  }
  if (command.temperature !== undefined && !isTemperature(command.temperature)) {
    return fail(touch(session, command.now), "invalid_temperature");
  }

  const temperature = command.temperature;
  const existing = session.lines.find(
    (line) => line.productId === item.id && line.temperature === temperature,
  );
  if (existing) {
    const merged = existing.quantity + quantity;
    if (merged > MAX_QUANTITY) {
      return fail(touch(session, command.now), "invalid_quantity");
    }
    const lines = session.lines.map((line) =>
      line.lineId === existing.lineId ? { ...line, quantity: merged } : line,
    );
    return ok(editCart(session, lines, command.now));
  }

  const line: CartLine = {
    lineId: `L${session.nextLineNumber}`,
    productId: item.id,
    quantity,
    ...(temperature !== undefined ? { temperature } : {}),
  };
  return ok(
    editCart(session, [...session.lines, line], command.now, {
      nextLineNumber: session.nextLineNumber + 1,
    }),
  );
}

function applySetTemperature(
  session: OrderSession,
  command: Extract<OrderCommand, { type: "set_temperature" }>,
): ApplyResult {
  const line = session.lines.find((candidate) => candidate.lineId === command.lineId);
  if (!line) {
    return fail(touch(session, command.now), "unknown_line");
  }
  const item = getItem(line.productId);
  if (!item?.requiresTemperature) {
    return fail(touch(session, command.now), "temperature_not_allowed");
  }
  if (!isTemperature(command.temperature)) {
    return fail(touch(session, command.now), "invalid_temperature");
  }
  if (line.temperature === command.temperature) {
    return ok(touch(session, command.now));
  }

  const others = session.lines.filter((candidate) => candidate.lineId !== line.lineId);
  const mergeInto = others.find(
    (candidate) =>
      candidate.productId === line.productId && candidate.temperature === command.temperature,
  );
  if (mergeInto) {
    const quantity = mergeInto.quantity + line.quantity;
    if (quantity > MAX_QUANTITY) {
      return fail(touch(session, command.now), "invalid_quantity");
    }
    const lines = others.map((candidate) =>
      candidate.lineId === mergeInto.lineId ? { ...candidate, quantity } : candidate,
    );
    return ok(editCart(session, lines, command.now));
  }

  const lines = session.lines.map((candidate) =>
    candidate.lineId === line.lineId ? { ...candidate, temperature: command.temperature } : candidate,
  );
  return ok(editCart(session, lines, command.now));
}

function applySetQuantity(
  session: OrderSession,
  command: Extract<OrderCommand, { type: "set_quantity" }>,
): ApplyResult {
  const line = session.lines.find((candidate) => candidate.lineId === command.lineId);
  if (!line) {
    return fail(touch(session, command.now), "unknown_line");
  }
  if (!isQuantity(command.quantity)) {
    return fail(touch(session, command.now), "invalid_quantity");
  }
  if (line.quantity === command.quantity) {
    return ok(touch(session, command.now));
  }
  const lines = session.lines.map((candidate) =>
    candidate.lineId === line.lineId ? { ...candidate, quantity: command.quantity } : candidate,
  );
  return ok(editCart(session, lines, command.now));
}

function applyRemove(
  session: OrderSession,
  command: Extract<OrderCommand, { type: "remove_line" }>,
): ApplyResult {
  if (!session.lines.some((line) => line.lineId === command.lineId)) {
    return fail(touch(session, command.now), "unknown_line");
  }
  const lines = session.lines.filter((line) => line.lineId !== command.lineId);
  return ok(editCart(session, lines, command.now));
}

function applyReadBack(session: OrderSession, now: number): ApplyResult {
  if (session.lines.length === 0) {
    return fail(touch(session, now), "cart_empty");
  }
  const missing = missingFor(session);
  if (missing.length > 0) {
    return fail(touch(session, now), "incomplete", missing);
  }
  const next: OrderSession = {
    ...touch(session, now),
    phase: "awaiting_confirmation",
    readBackVersion: session.cartVersion,
    confirmedBy: null,
  };
  return { ...ok(next), readBack: buildReadBack(next) };
}

function applyRevise(session: OrderSession, now: number): ApplyResult {
  if (session.phase !== "awaiting_confirmation" && session.phase !== "ready_to_pay") {
    return fail(touch(session, now), "not_awaiting_confirmation");
  }
  return ok({
    ...touch(session, now),
    phase: session.lines.length === 0 ? "browsing" : "drafting",
    readBackVersion: null,
    confirmedBy: null,
  });
}

function applyConfirm(
  session: OrderSession,
  command: Extract<OrderCommand, { type: "confirm" }>,
): ApplyResult {
  if (command.cartVersion !== session.cartVersion) {
    return fail(touch(session, command.now), "stale_cart");
  }
  if (session.phase !== "awaiting_confirmation" || session.readBackVersion !== session.cartVersion) {
    return fail(touch(session, command.now), "not_awaiting_confirmation");
  }
  const missing = missingFor(session);
  if (missing.length > 0) {
    return fail(touch(session, command.now), "incomplete", missing);
  }
  const next: OrderSession = {
    ...touch(session, command.now),
    phase: "ready_to_pay",
    confirmedBy: command.source,
  };
  return { ...ok(next), readBack: buildReadBack(next) };
}

/** Empty the cart without abandoning the session. */
function applyClear(session: OrderSession, now: number): ApplyResult {
  if (session.lines.length === 0) {
    return ok(touch(session, now));
  }
  return ok(editCart(session, [], now));
}

function abandon(session: OrderSession): OrderSession {
  return {
    ...session,
    phase: "abandoned",
    lines: [],
    cartVersion: session.cartVersion + 1,
    readBackVersion: null,
    confirmedBy: null,
    idlePrompted: true,
  };
}

function editCart(
  session: OrderSession,
  lines: readonly CartLine[],
  now: number,
  extra?: Pick<OrderSession, "nextLineNumber">,
): OrderSession {
  return {
    ...touch(session, now),
    lines,
    cartVersion: session.cartVersion + 1,
    readBackVersion: null,
    confirmedBy: null,
    phase: lines.length === 0 ? "browsing" : "drafting",
    ...extra,
  };
}

function touch(session: OrderSession, now: number): OrderSession {
  return { ...session, lastActivityAt: now, idlePrompted: false };
}

function missingFor(session: OrderSession): MissingField[] {
  const missing: MissingField[] = [];
  for (const line of session.lines) {
    const item = getItem(line.productId);
    if (item?.requiresTemperature && line.temperature === undefined) {
      missing.push({ lineId: line.lineId, productId: line.productId, field: "temperature" });
    }
  }
  return missing;
}

function buildReadBack(session: OrderSession): ReadBack {
  const lines: ReadBackLine[] = session.lines.map((line) => {
    const item = getItem(line.productId);
    const unitPriceCents = item?.priceCents ?? 0;
    return {
      lineId: line.lineId,
      productId: line.productId,
      name: item?.name ?? line.productId,
      quantity: line.quantity,
      ...(line.temperature !== undefined ? { temperature: line.temperature } : {}),
      unitPriceCents,
      lineTotalCents: unitPriceCents * line.quantity,
    };
  });
  return {
    cartVersion: session.cartVersion,
    machineId: session.machineId,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
  };
}

function ok(session: OrderSession): ApplyResult {
  return {
    session,
    ok: true,
    missing: missingFor(session),
    idlePrompt: false,
  };
}

function fail(
  session: OrderSession,
  reason: RejectReason,
  missing: readonly MissingField[] = missingFor(session),
): ApplyResult {
  return {
    session,
    ok: false,
    reason,
    missing,
    idlePrompt: false,
  };
}

function isQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY;
}

function isTemperature(value: string): value is Temperature {
  return (TEMPERATURES as readonly string[]).includes(value);
}
