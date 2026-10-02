import { operatorAllowed, operatorConfigured } from "../../operator/access";
import styles from "./operator.module.css";

export async function Gate({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  if (!operatorConfigured()) {
    return (
      <main className={styles.page}>
        <section className={`${styles.panel} ${styles.gate}`}>
          <p className={styles.kicker}>Operator</p>
          <h1>Set a password</h1>
          <p className={styles.sub}>Add OPERATOR_PASSWORD to the server environment. It is not sent to the browser.</p>
        </section>
      </main>
    );
  }
  if (!(await operatorAllowed())) {
    return (
      <main className={styles.page}>
        <form className={`${styles.panel} ${styles.gate}`} action="/api/operator/login" method="post">
          <p className={styles.kicker}>Operator</p>
          <h1>Sign in</h1>
          <p className={styles.sub}>Orders stay on the server. This page is not indexed.</p>
          {error ? <p className={styles.warn}>That password did not match.</p> : null}
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
            View orders
          </button>
        </form>
      </main>
    );
  }
  return children;
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <main className={styles.page}>{<div className={styles.wrap}>{children}</div>}</main>;
}
