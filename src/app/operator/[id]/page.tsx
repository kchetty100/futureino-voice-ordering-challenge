import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatSeconds, formatUsd } from "../../../operator/cost";
import { machineName, money, orderTotal, phaseName, speaker, when } from "../../../operator/format";
import { operatorAllowed, operatorConfigured } from "../../../operator/access";
import { operatorSession } from "../../../operator/log";
import { Gate, Shell } from "../gate";
import styles from "../operator.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order · Futureino",
  robots: { index: false, follow: false },
};

export default async function OperatorOrderPage({ params }: { params: Promise<{ id: string }> }) {
  if (!operatorConfigured() || !(await operatorAllowed())) return <Gate>{null}</Gate>;
  const { id } = await params;
  const session = await operatorSession(id);
  if (!session) notFound();
  return (
    <Gate>
      <Shell>
        <header className={styles.top}>
          <div>
            <p className={styles.kicker}>
              <Link className={styles.back} href="/operator">
                Orders
              </Link>
            </p>
            <h1>{machineName(session.machineId)}</h1>
            <p className={styles.sub}>
              {phaseName(session.phase)} · opened {when(session.openedAt)}
            </p>
          </div>
        </header>
        <ul className={styles.stats}>
          <li className={styles.stat}>
            Cost
            <b>{orderTotal(session) ?? "—"}</b>
          </li>
          <li className={styles.stat}>
            Speech
            <b>{formatUsd(session.costUsd)}</b>
          </li>
          <li className={styles.stat}>
            Audio
            <b>{formatSeconds(session.audioSeconds)}</b>
          </li>
          <li className={styles.stat}>
            Tokens
            <b>
              {session.inputTokens} in · {session.outputTokens} out
            </b>
          </li>
        </ul>
        <div className={styles.columns}>
          <section className={styles.panel}>
            <h2>Transcript</h2>
            {session.transcript.length === 0 ? <p className={styles.muted}>Nothing said yet.</p> : null}
            {session.transcript.map((entry, index) => (
              <article className={styles.turn} key={`${entry.at}-${index}`}>
                {entry.customer ? (
                  <>
                    <p className={styles.who}>{speaker(entry, "customer")}</p>
                    <p className={styles.line}>{entry.customer}</p>
                  </>
                ) : null}
                {entry.say ? (
                  <>
                    <p className={styles.who}>{speaker(entry, "say")}</p>
                    <p className={styles.line}>{entry.say}</p>
                  </>
                ) : null}
              </article>
            ))}
          </section>
          <section className={styles.panel}>
            <h2>Cart versions</h2>
            {session.carts.length === 0 ? <p className={styles.muted}>No cart. A machine was not chosen.</p> : null}
            {session.carts.map((cart, index) => (
              <article className={styles.version} key={`${cart.cartVersion}-${cart.phase}-${index}`}>
                <div className={styles.row}>
                  <strong>Version {cart.cartVersion}</strong>
                  <span className={styles.meta}>{money(cart.totalCents)}</span>
                </div>
                <p className={styles.meta}>
                  {phaseName(cart.phase)} · {when(cart.at)}
                </p>
                {cart.lines.length === 0 ? <p className={styles.muted}>Empty</p> : null}
                {cart.lines.length > 0 ? (
                  <ul>
                    {cart.lines.map((line) => (
                      <li key={`${line.name}-${line.temperature ?? "none"}-${line.quantity}`}>
                        {`${line.name}${line.temperature ? `, ${line.temperature}` : ""} × ${line.quantity} · ${money(line.lineTotalCents)}`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </section>
        </div>
      </Shell>
    </Gate>
  );
}
