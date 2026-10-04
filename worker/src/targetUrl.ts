/** 取得してよい URL かを検査した結果 */
export type TargetUrlCheck = { ok: true; url: URL } | { ok: false; error: "invalid-url" | "blocked-url" };

/**
 * 取得先として受け付ける URL を検査する (SSRF 対策)。http / https 以外、認証情報付き、
 * localhost・.local 等の内部向けの名前、プライベート・ループバック・リンクローカル等の IP アドレスを拒否する。
 * 名前解決の結果までは確かめないが、Worker は Cloudflare のエッジから取得するため利用者・提供者の内部ネットワークには届かない
 */
export function checkTargetUrl(input: string): TargetUrlCheck {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "invalid-url" };
  }
  if (url.username !== "" || url.password !== "" || isBlockedHostname(url.hostname)) {
    return { ok: false, error: "blocked-url" };
  }
  return { ok: true, url };
}

/**
 * 公開のインターネットに無い名前の接尾辞。RFC 6761 (localhost・test・invalid)、RFC 6762 (local)、RFC 8375 (home.arpa)、
 * ICANN が内部用に予約した internal、慣習的に LAN で使われる lan・intranet・corp・localdomain
 */
const internalHostnameSuffixes = [
  "localhost",
  "local",
  "test",
  "invalid",
  "internal",
  "home.arpa",
  "lan",
  "intranet",
  "corp",
  "localdomain",
];

/** URL のホスト名 (URL が正規化した小文字・IPv6 は [] 付き) が、内部向けの名前か公開でない IP アドレスなら true を返す */
export function isBlockedHostname(hostname: string): boolean {
  const name = hostname.replace(/\.$/, "");
  if (name.startsWith("[")) {
    return isBlockedIpv6(name.slice(1, -1));
  }
  const ipv4 = parseIpv4(name);
  if (ipv4) {
    return isBlockedIpv4(ipv4);
  }
  // 点の無い名前は社内の DNS の検索ドメインで解決される名前のため拒否する
  return !name.includes(".") || internalHostnameSuffixes.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

/** URL が正規化した IPv4 の表記 (10 進の 4 つ組) を 4 つの数に分ける。IPv4 でなければ undefined を返す */
function parseIpv4(name: string): number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  return match ? match.slice(1).map(Number) : undefined;
}

/** 公開のインターネットで到達できない IPv4 (RFC 6890 の特別用途のアドレス) なら true を返す */
function isBlockedIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** 公開のインターネットで到達できない IPv6 (未指定・ループバック・ユニークローカル・リンクローカル・IPv4 射影の非公開アドレス) なら true を返す */
function isBlockedIpv6(address: string): boolean {
  if (address === "::" || address === "::1") {
    return true;
  }
  // URL は IPv4 射影アドレスを ::ffff:7f00:1 の形に正規化する
  const mappedIpv4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mappedIpv4) {
    const high = parseInt(mappedIpv4[1], 16);
    const low = parseInt(mappedIpv4[2], 16);
    return isBlockedIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  const firstGroup = parseInt(address.split(":")[0] || "0", 16);
  return (firstGroup & 0xfe00) === 0xfc00 || (firstGroup & 0xffc0) === 0xfe80 || (firstGroup & 0xff00) === 0xff00;
}
