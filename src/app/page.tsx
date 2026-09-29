import Link from "next/link";

// リーダー本体とプロダクト紹介はロードマップの子 issue で作る。立ち上げ時点では公開 URL と法務ページへの導線だけを置く
export default function HomePage() {
  return (
    <main>
      <h1>sokudoku</h1>
      <p>日本語・英語の文章を 1 語ずつ同じ位置へ表示して速く読む RSVP 速読リーダー (準備中)</p>
      <ul>
        <li>
          <Link href="/read/">リーダーを開く</Link>
        </li>
        <li>
          <Link href="/terms/">利用規約</Link>
        </li>
        <li>
          <Link href="/privacy/">プライバシーポリシー</Link>
        </li>
      </ul>
    </main>
  );
}
