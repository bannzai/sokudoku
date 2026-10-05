// 本文の抽出と /extract の test で使う、Readability が記事と判定する長さの日本語のページ

/** 記事の段落。Readability の記事の判定 (本文 500 文字以上) を満たす長さにする */
export const articleParagraphs = [
  "速読とは、文章を通常よりも速い速度で読み、内容を理解する技術の総称である。古くから様々な方法が提案されてきた。",
  "そのうちの一つである RSVP は、画面の同じ位置に単語を一つずつ切り替えて表示し、目を動かさずに読み進める方式だ。視線の移動にかかる時間を減らせるため、短い文章であれば速く読めると言われている。",
  "一方で、読む速度を上げすぎると理解度が下がることも知られている。自分に合った速度を選び、必要なら止めて読み返せることが大切になる。",
  "日本語の文章では、単語ではなく文節を単位にすると読みやすい。助詞が前の語に付いたまま表示されるため、意味のまとまりを保ったまま読める。",
];

/** 見出し・ナビゲーション・ルビ・スクリプトを含む記事のページの HTML */
export const articleHtml = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>速読の方法 - サンプルの百科事典</title>
  <meta property="og:site_name" content="サンプルの百科事典">
  <script>console.log("tracking")</script>
</head>
<body>
  <nav><ul><li><a href="/">トップ</a></li><li><a href="/about">このサイトについて</a></li></ul></nav>
  <article>
    <h1>速読の方法</h1>
    <p>${articleParagraphs[0]}</p>
    <h2>RSVP</h2>
    <p>${articleParagraphs[1].replace("RSVP", "<b>RSVP</b>")}</p>
    <p>${articleParagraphs[2]}</p>
    <p>${articleParagraphs[3].replace("文節", "<ruby>文節<rt>ぶんせつ</rt></ruby>")}</p>
  </article>
  <footer>Copyright サンプル</footer>
</body>
</html>`;
