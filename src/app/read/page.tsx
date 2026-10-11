import Link from "next/link";

/**
 * 以前のリーダーの URL (/read/)。共有済みのリンクのために残し、トップページのリーダーへ移す。
 * 静的書き出し (ADR 0001) にはサーバーが無く、next/navigation の redirect も書き出したページでは効かないため、
 * meta refresh で移す。移り先は basePath (/sokudoku) を含めるため、/read/ から見た相対の ../ で書く
 */
export default function ReadPage() {
  return (
    <main>
      <meta httpEquiv="refresh" content="0; url=../" />
      <p>
        リーダーはトップページへ移りました <Link href="/">リーダーを開く</Link>
      </p>
    </main>
  );
}
