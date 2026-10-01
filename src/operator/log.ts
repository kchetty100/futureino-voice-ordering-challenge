import { AsyncLocalStorage } from "node:async_hooks";
import { getItem, type MachineId } from "../catalog/index";
import type { OrderSession, Phase } from "../order/engine";
import { estimateUsd, type ModelUsage } from "./cost";

export type TranscriptSource = "text" | "voice" | "touch" | "system";

export type TranscriptEntry = {
  at: number;
  source: TranscriptSource;
  customer: string | null;
  say: string | null;
};

export type CartVersionLine = {
  name: string;
  quantity: number;
  temperature: string | null;
  lineTotalCents: number;
};

export type CartVersion = {
  at: number;
  cartVersion: number;
  phase: Phase;
  lines: CartVersionLine[];
  totalCents: number;
};

export type OperatorView = {
  id: string;
  machineId: MachineId | null;
  openedAt: number;
  updatedAt: number;
  phase: Phase | "lobby";
  transcript: TranscriptEntry[];
  carts: CartVersion[];
  usage: ModelUsage[];
  costUsd: number;
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
};

type Record = {
  id: string;
  machineId: MachineId | null;
  openedAt: number;
  updatedAt: number;
  phase: Phase | "lobby";
  transcript: TranscriptEntry[];
  carts: CartVersion[];
  usage: ModelUsage[];
  signature: string;
};

const scope = globalThis as unknown as { futureinoRecords?: Map<string, Record> };
const records = scope.futureinoRecords ?? new Map<string, Record>();
scope.futureinoRecords = records;
const current = new AsyncLocalStorage<string>();

export function beginRecord(session: OrderSession, now: number) {
  records.set(session.id, {
    id: session.id,
    machineId: session.machineId,
    openedAt: now,
    updatedAt: now,
    phase: session.phase,
    transcript: [],
    carts: [cartVersion(session, now)],
    usage: [],
    signature: signature(session),
  });
}

/** A turn on the opening screen, before a machine is chosen. */
export function beginLobby(now: number): string {
  const id = `lobby-${crypto.randomUUID()}`;
  records.set(id, {
    id,
    machineId: null,
    openedAt: now,
    updatedAt: now,
    phase: "lobby",
    transcript: [],
    carts: [],
    usage: [],
    signature: "",
  });
  return id;
}

export function recordTurn(id: string, entry: TranscriptEntry) {
  const record = records.get(id);
  if (!record) return;
  record.transcript.push(entry);
  record.updatedAt = entry.at;
}

export function recordState(id: string, session: OrderSession, now: number) {
  const record = records.get(id);
  if (!record) return;
  record.machineId = session.machineId;
  record.phase = session.phase;
  record.updatedAt = now;
  const next = signature(session);
  if (next === record.signature) return;
  record.signature = next;
  record.carts.push(cartVersion(session, now));
}

export function noteUsageFor(id: string, usage: ModelUsage | null | undefined) {
  if (!usage) return;
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0 && usage.audioSeconds <= 0) return;
  const record = records.get(id);
  if (!record) return;
  record.usage.push(usage);
  record.updatedAt = Date.now();
}

export function duringSession<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return current.run(id, fn);
}

/** Attach a model call to the session whose turn is running. */
export function noteUsage(usage: ModelUsage | null | undefined) {
  const id = current.getStore();
  if (!id) return;
  noteUsageFor(id, usage);
}

export function listOperatorSessions(): OperatorView[] {
  return [...records.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(publish);
}

export function operatorSession(id: string): OperatorView | null {
  const record = records.get(id);
  return record ? publish(record) : null;
}

function publish(record: Record): OperatorView {
  const inputTokens = record.usage.reduce((sum, event) => sum + event.inputTokens, 0);
  const outputTokens = record.usage.reduce((sum, event) => sum + event.outputTokens, 0);
  return {
    id: record.id,
    machineId: record.machineId,
    openedAt: record.openedAt,
    updatedAt: record.updatedAt,
    phase: record.phase,
    transcript: record.transcript.map((entry) => ({ ...entry })),
    carts: record.carts.map((cart) => ({ ...cart, lines: cart.lines.map((line) => ({ ...line })) })),
    usage: record.usage.map((event) => ({ ...event })),
    costUsd: estimateUsd(record.usage),
    audioSeconds: roundSeconds(record.usage.reduce((sum, event) => sum + event.audioSeconds, 0)),
    inputTokens,
    outputTokens,
  };
}

function cartVersion(session: OrderSession, at: number): CartVersion {
  const lines = session.lines.map((line) => {
    const item = getItem(line.productId);
    const unit = item?.priceCents ?? 0;
    return {
      name: item?.name ?? line.productId,
      quantity: line.quantity,
      temperature: line.temperature ?? null,
      lineTotalCents: unit * line.quantity,
    };
  });
  return {
    at,
    cartVersion: session.cartVersion,
    phase: session.phase,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0),
  };
}

function signature(session: OrderSession): string {
  const lines = session.lines
    .map((line) => `${line.lineId}:${line.productId}:${line.quantity}:${line.temperature ?? ""}`)
    .join(",");
  return `${session.cartVersion}|${session.phase}|${lines}`;
}

function roundSeconds(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
