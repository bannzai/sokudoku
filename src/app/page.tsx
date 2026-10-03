import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import styles from "./page.module.css";

const description =
  "日本語と英語の文章を 1 文節 (英語は 1 単語) ずつ画面の同じ位置に表示する RSVP 速読リーダー。読み込んだ本文はブラウザの外へ送りません。";

export const metadata: Metadata = {
  title: "sokudoku | 日本語と英語を 1 語ずつ読む RSVP 速読リーダー",
  description,
};

/** トップページ (LP)。何ができるか・使い方・本文の扱い・対応環境・問い合わせ先を示し、リーダー (/read/) へ導く */
export default function HomePage() {
  return (
    <main>
      <script
        type="application/ld+json"
        // JSON 内の < で script 要素が閉じないようにエスケープする
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "sokudoku",
            url: siteUrl,
            description,
            applicationCategory: "UtilitiesApplication",
            inLanguage: "ja",
          }).replace(/</g, "\\u003c"),
        }}
      />

      <section className={styles.hero}>
        <p className={styles.productName}>sokudoku</p>
        <h1 className={styles.title}>
          日本語と英語を 1 語ずつ読む
          <br />
          RSVP 速読リーダー
        </h1>
        <p className={styles.lead}>
          文章を 1 文節 (英語は 1 単語) ずつ、画面の同じ位置に切り替えて表示します。目を左右に動かさずに、自分で決めた速度で読み進められます。
        </p>
        <Link href="/read/" className={styles.primaryAction}>
          リーダーを開く
        </Link>
        <figure className={styles.preview}>
          <div className={styles.stage} aria-hidden="true">
            同じ位置に
          </div>
          <figcaption className={styles.caption}>再生中は文節だけが中央に切り替わって表示されます</figcaption>
        </figure>
      </section>

      <section className={styles.section} aria-labelledby="usage">
        <h2 id="usage" className={styles.heading}>
          使い方
        </h2>
        <ul className={styles.steps}>
          <li>
            <h3 className={styles.stepTitle}>文章を入れる</h3>
            <p>読みたい文章を貼り付けるか、テキストファイル (青空文庫の txt を含む) や EPUB を読み込みます。DRM の付いた電子書籍は読み込めません。</p>
          </li>
          <li>
            <h3 className={styles.stepTitle}>再生と停止</h3>
            <p>space キーか画面のボタンで再生と一時停止を切り替えます。停止中は全文が表示され、読んでいる位置がハイライトされます。</p>
          </li>
          <li>
            <h3 className={styles.stepTitle}>速度を決める</h3>
            <p>日本語は 1 分あたりの文字数、英語は 1 分あたりの単語数で速度を設定します。再生中も変えられます。</p>
          </li>
          <li>
            {/* 訳の出し入れは #6 で実装する。実装されるまで準備中と書く */}
            <h3 className={styles.stepTitle}>英文の訳を出す (準備中)</h3>
            <p>英文を読んでいる途中で T キーか画面のボタンを押すと、いま読んでいる文の日本語訳を出し入れできるようにする予定です。</p>
          </li>
        </ul>
        <p className={styles.note}>
          文節の区切りや訳には誤りが含まれることがあります。読む速さや内容の理解度が上がることを保証するものではありません。
        </p>
      </section>

      <section className={styles.section} aria-labelledby="privacy">
        <h2 id="privacy" className={styles.heading}>
          本文はブラウザの外へ送りません
        </h2>
        <p>
          貼り付けた文章や読み込んだファイルは、お使いのブラウザの中だけで処理します。本文をサーバーへ送ることはなく、提供者が本文を受け取ったり保存したりすることもありません。
        </p>
        {/* source: https://developer.chrome.com/docs/ai/translator-api : 「The API is built into Chrome, and the model is downloaded the first time a website uses this API.」「client-side translation」 */}
        <p>
          英文の訳 (準備中) も、ブラウザ (Google Chrome) に内蔵された翻訳機能で端末上で行います。速度などの設定、読書の位置、読んだ量の記録はこのブラウザのストレージにだけ保存され、サイトデータを消去するといつでも消せます。本文そのものはこのブラウザにも保存しません。
        </p>
      </section>

      <section className={styles.section} aria-labelledby="environment">
        <h2 id="environment" className={styles.heading}>
          対応環境
        </h2>
        {/* source: https://developer.chrome.com/docs/ai/translator-api : 対応は Chrome 138 以降。「The Language Detector and Translator APIs work in Chrome on desktop. These APIs don't work on mobile devices.」 */}
        <p>
          英文の日本語訳は準備中です。Chrome の Translator API を使うため、使えるのはデスクトップの Google Chrome 138 以降になります。
        </p>
      </section>

      <section className={styles.section} aria-labelledby="contact">
        <h2 id="contact" className={styles.heading}>
          お問い合わせ
        </h2>
        <p>ご意見や不具合の報告は、次のメールアドレスへお送りください。</p>
        <p>
          <a href="mailto:bannzai.app@gmail.com">bannzai.app@gmail.com</a>
        </p>
      </section>

      <footer className={styles.footer}>
        <nav aria-label="規約">
          <ul className={styles.footerLinks}>
            <li>
              <Link href="/terms/">利用規約</Link>
            </li>
            <li>
              <Link href="/privacy/">プライバシーポリシー</Link>
            </li>
          </ul>
        </nav>
      </footer>
    </main>
  );
}
