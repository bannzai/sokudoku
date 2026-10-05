// 本文の抽出の test で使う、Wikipedia (MediaWiki の Vector 2022 の外装) と同じ構造の合成した記事のページ

/** 記事の段落。出典番号を除いた、本文として取り出されるべき文字 */
export const wikipediaParagraphs = [
  "ニンニク（大蒜、学名: Allium sativum）は、ヒガンバナ科ネギ属の多年草。地下にできる鱗茎を香味野菜や香辛料として使い、強い香りを持つことで知られる。",
  "古くから世界各地で栽培されてきた作物で、原産地は中央アジアと考えられている。寒さに強く、秋に植えた鱗片が冬を越して初夏に収穫される。",
  "国内では寒冷な地域が主な産地として知られる。植え付けの前に鱗片を一つずつ分け、尖った方を上にして土に埋める。",
  "料理では刻んだりすりおろしたりして、肉や魚の臭みを消す香り付けに使う。加熱すると香りが和らぎ甘みが出るため、丸ごと焼いて食べることもある。",
];

/** infobox (分類表) のセルの文字。本文の段落には現れない文字にする */
export const wikipediaInfoboxCells = ["植物界 Plantae", "被子植物門 Magnoliophyta", "単子葉植物綱 Liliopsida"];

/**
 * MediaWiki が本文中に付ける出典番号の sup 要素の HTML。
 * label は角括弧の中の文字 (4・注 1 等)、citeNumber は脚注へのリンクの番号
 */
function referenceSupHtml(label: string, citeNumber: number): string {
  return `<sup id="cite_ref-${citeNumber}" class="reference"><a href="#cite_note-${citeNumber}"><span class="cite-bracket">&#91;</span>${label}<span class="cite-bracket">&#93;</span></a></sup>`;
}

/** MediaWiki の見出し (h2 と [編集] リンク) の HTML */
function headingHtml(heading: string): string {
  return `<div class="mw-heading mw-heading2"><h2 id="${heading}">${heading}</h2><span class="mw-editsection"><span class="mw-editsection-bracket">[</span><a href="/w/index.php?title=ニンニク&amp;action=edit&amp;section=1" title="節を編集: ${heading}"><span>編集</span></a><span class="mw-editsection-bracket">]</span></span></div>`;
}

/** infobox の表・出典番号の sup・「出典: フリー百科事典…」の行 (#siteSub)・見出しの [編集] リンクを含む記事のページの HTML */
export const wikipediaHtml = `<!doctype html>
<html lang="ja" dir="ltr">
<head>
  <meta charset="utf-8">
  <title>ニンニク - Wikipedia</title>
</head>
<body class="skin-vector-2022 mediawiki">
  <nav id="mw-panel" class="vector-main-menu"><ul><li><a href="/wiki/メインページ">メインページ</a></li><li><a href="/wiki/Special:Random">おまかせ表示</a></li></ul></nav>
  <main id="content" class="mw-body">
    <header class="mw-body-header vector-page-titlebar">
      <h1 id="firstHeading" class="firstHeading mw-first-heading"><span class="mw-page-title-main">ニンニク</span></h1>
    </header>
    <div id="bodyContent" class="vector-body">
      <div id="siteSub" class="noprint">出典: フリー百科事典『ウィキペディア（Wikipedia）』</div>
      <div id="contentSub"></div>
      <div id="mw-content-text" class="mw-body-content">
        <div class="mw-content-ltr mw-parser-output" lang="ja" dir="ltr">
          <table class="infobox bordered" style="width:22em">
            <tbody>
              <tr><th colspan="3">ニンニク</th></tr>
              <tr><th colspan="3">分類（APG IV）</th></tr>
              <tr><td>界</td><td>:</td><td>${wikipediaInfoboxCells[0]}</td></tr>
              <tr><td>門</td><td>:</td><td>${wikipediaInfoboxCells[1]}</td></tr>
              <tr><td>綱</td><td>:</td><td>${wikipediaInfoboxCells[2]}</td></tr>
            </tbody>
          </table>
          <p>${wikipediaParagraphs[0]
            .replace("ニンニク（大蒜", `<b>ニンニク</b>（大蒜${referenceSupHtml("4", 4)}${referenceSupHtml("5", 5)}`)
            .replace("Allium sativum", "<i>Allium sativum</i>")
            .replace("ヒガンバナ科", `ヒガンバナ科${referenceSupHtml("注 1", 1)}`)
            .replace("香辛料として使い", `香辛料として使い${referenceSupHtml("6", 6)}`)}</p>
          <p>${wikipediaParagraphs[1].replace("考えられている。", `考えられている。${referenceSupHtml("7", 7)}`)}</p>
          ${headingHtml("栽培")}
          <p>${wikipediaParagraphs[2]}</p>
          ${headingHtml("利用")}
          <p>${wikipediaParagraphs[3]}</p>
        </div>
      </div>
    </div>
  </main>
  <footer id="footer" class="mw-footer">最終更新 2026年10月5日</footer>
</body>
</html>`;
