import type { Metadata } from "next";
import { operatorConfigured, safeNext } from "../../operator/secret";
import styles from "../operator/operator.module.css";

export const metadata: Metadata = {
  title: "Locked · Futureino",
  robots: { index: false, follow: false },
};

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const query = await searchParams;
  const next = safeNext(query.next ?? "/");
  if (!operatorConfigured()) {
    return (
      <main className={styles.page}>
        <section className={`${styles.panel} ${styles.gate}`}>
          <p className={styles.kicker}>Futureino</p>
          <h1>Set a password</h1>
          <p className={styles.sub}>Add OPERATOR_PASSWORD to the server environment. It is not sent to the browser.</p>
        </section>
      </main>
    );
  }
  return (
    <main className={styles.page}>
      <form className={`${styles.panel} ${styles.gate}`} action="/api/operator/login" method="post">
        <p className={styles.kicker}>Futureino</p>
        <h1>This machine is locked</h1>
        <p className={styles.sub}>Enter the password to use the machine.</p>
        {query.error === "1" ? <p className={styles.warn}>That password did not match.</p> : null}
        {query.error === "2" ? <p className={styles.warn}>Too many tries. Wait a little while and try again.</p> : null}
        <input type="hidden" name="next" value={next} />
        <label className={styles.field} htmlFor="password">
          Password
        </label>
        <input
          className={styles.password}
          id="password"
          name="password"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
        />
        <button className={styles.submit} type="submit">
          Open the machine
        </button>
      </form>
    </main>
  );
}
