import Link from "next/link";
import styles from "./AppBar.module.css";

/** 上部のバーに渡す値。 */
type AppBarProps = {
  /** サービス名の反対側に出す、今の画面の説明。無ければサービス名だけを出す。 */
  description?: string;
};

/** トップページ以外の画面の上部に出すバー。サービス名をトップページへのリンクにする。 */
export function AppBar({ description }: AppBarProps) {
  return (
    <header className={styles.appBar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.name}>
          sokudoku
        </Link>
        {description !== undefined && <span className={styles.description}>{description}</span>}
      </div>
    </header>
  );
}
