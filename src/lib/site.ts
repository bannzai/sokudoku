/**
 * 公開サイトの URL。GitHub Pages のプロジェクトサイトで配信するため basePath (/sokudoku) を含む
 * (documents/adr/0001-static-export-on-github-pages.md)。OGP・JSON-LD・sitemap の絶対 URL はこれを基準に解決する。
 * 末尾の / は、`new URL("terms/", siteUrl)` のような相対の解決で /sokudoku を残すために要る
 */
export const siteUrl = "https://bannzai.github.io/sokudoku/";
