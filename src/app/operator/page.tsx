import type { Metadata } from "next";
import Link from "next/link";
import { formatSeconds, formatUsd } from "../../operator/cost";
import { machineName, phaseName, preview, when } from "../../operator/format";
import { listOperatorSessions } from "../../operator/log";
import { Gate, Shell } from "./gate";
import styles from "./operator.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orders · Futureino",
  robots: { index: false, follow: false },
};

export default async function OperatorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  return (
    <Gate error={query.error}>
      <Shell>
        <header className={styles.top}>
          <div>
            <p className={styles.kicker}>Operator</p>
            <h1>Orders</h1>
            <p className={styles.sub}>Transcript, cart versions, and what the conversation cost.</p>
          </div>
          <form action="/api/operator/logout" method="post">
            <button className={styles.out} type="submit">
              Sign out
            </button>
          </form>
        </header>
        <OrderList />
      </Shell>
    </Gate>
  );
}

async function OrderList() {
  const sessions = await listOperatorSessions();
  if (sessions.length === 0) {
    return (
      <section className={styles.panel}>
        <p className={styles.muted}>No orders yet. They show up here as customers talk to a machine.</p>
      </section>
    );
  }
  return (
    <ul className={styles.list}>
      {sessions.map((session) => (
        <li key={session.id}>
          <Link className={styles.card} href={`/operator/${session.id}`}>
            <div className={styles.row}>
              <span className={styles.machine}>{machineName(session.machineId)}</span>
              <span className={styles.meta}>{when(session.updatedAt)}</span>
            </div>
            <p className={styles.preview}>{preview(session)}</p>
            <p className={styles.meta}>
              {phaseName(session.phase)} · {session.transcript.length} turns · {formatUsd(session.costUsd)} ·{" "}
              {formatSeconds(session.audioSeconds)} audio
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
