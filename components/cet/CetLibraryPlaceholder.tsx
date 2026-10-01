import styles from "./CetLibraryPlaceholder.module.css";

export function CetLibraryPlaceholder() {
  return <div className={styles.grid} role="status" aria-label="真题目录" aria-busy="true">
    {Array.from({ length: 4 }, (_, index) => <div key={index} className={styles.row} aria-hidden="true">
      <span className={styles.cover} />
      <span className={styles.copy}><i /><i /><i /></span>
    </div>)}
  </div>;
}
