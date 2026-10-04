import Link from "next/link";
import styles from "./AppBar.module.css";

/** 上部のバーに渡す値。 */
type AppBarProps = {
  /** サービス名の反対側に出す、今の画面の説明。無ければサービス名だけを出す。 */
  description?: string;
  /**
   * サービス名をトップページへのリンクにするか。読んでいる本文はメモリにだけあり、ページを離れると消えるため、
   * 本文を開いている画面では false にして誤って離れないようにする。
   * 省略時は true。本文を持たない画面 (取り込み・法務ページ) はトップページへ戻る導線として使うため。
   */
  linksToTop?: boolean;
};

/** トップページ以外の画面の上部に出すバー。 */
export function AppBar({ description, linksToTop = true }: AppBarProps) {
  return (
    <header className={styles.appBar}>
      <div className={styles.inner}>
        {linksToTop ? (
          <Link href="/" className={styles.name}>
            sokudoku
          </Link>
        ) : (
          <span className={styles.name}>sokudoku</span>
        )}
        {description !== undefined && <span className={styles.description}>{description}</span>}
      </div>
    </header>
  );
}
