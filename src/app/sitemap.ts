import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site";

// output: "export" で out/sitemap.xml に書き出すため、リクエストごとに生成しない
export const dynamic = "force-static";

/** 検索エンジンに知らせるページの一覧。/read/ はリーダー画面 (#5) が main に入ってから足す */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "terms/", "privacy/"].map((path) => ({ url: new URL(path, siteUrl).href }));
}
