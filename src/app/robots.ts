import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site";

// output: "export" で out/robots.txt に書き出すため、リクエストごとに生成しない
export const dynamic = "force-static";

/**
 * クローラー向けの robots.txt。配信先は https://bannzai.github.io/sokudoku/robots.txt になり、
 * RFC 9309 2.3 の「"/robots.txt" in the top-level path of the service」に当たらないためクローラーは読まない
 * ( https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3 )。sitemap は Search Console から直接登録する
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("sitemap.xml", siteUrl).href,
  };
}
