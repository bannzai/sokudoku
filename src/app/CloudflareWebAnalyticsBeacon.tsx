/**
 * Cloudflare Web Analytics の beacon (Cookie を使わず、ページの URL だけを送る計測) を置く。
 * GitHub Pages は Cloudflare のゾーンではなく自動注入が効かないため、手動の script タグで設置する (documents/adr/0001-static-export-on-github-pages.md)。
 * site token は HTML に載る公開値で、配信のビルド (deploy.yml) だけが環境変数 CLOUDFLARE_WEB_ANALYTICS_TOKEN で渡す。
 * 未設定のビルド (PR の CI・ローカル) では何も描画せず、計測を送らない。
 */
export function CloudflareWebAnalyticsBeacon() {
  const token = process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN;
  if (!token) {
    return null;
  }
  return (
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token })}
    />
  );
}
