/** 取得してよい URL かを検査した結果 */
export type TargetUrlCheck = { ok: true; url: URL } | { ok: false; error: "invalid-url" | "blocked-url" };

/**
 * 取得先として受け付ける URL を検査する (SSRF 対策)。http / https 以外、認証情報付き、
 * localhost・.local 等の内部向けの名前、プライベート・ループバック・リンクローカル等の IP アドレス、allowedPorts に無いポートを拒否する。
 * 名前解決の結果までは確かめないが、Worker は Cloudflare のエッジから取得するため利用者・提供者の内部ネットワークには届かない
 */
export function checkTargetUrl(input: string): TargetUrlCheck {
  if (input.length > maxTargetUrlLength) {
    return { ok: false, error: "invalid-url" };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "invalid-url" };
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    !allowedPorts.has(url.port) ||
    isBlockedHostname(url.hostname)
  ) {
    return { ok: false, error: "blocked-url" };
  }
  return { ok: true, url };
}

/**
 * 受け付ける URL の長さの上限。記事の URL はこれに収まり、長いパスで robots.txt の照合の CPU 時間を伸ばされないようにする
 * (2048 文字は、多くのブラウザ・CDN が扱える URL の長さとして広く使われる目安)
 */
const maxTargetUrlLength = 2048;

/** 受け付けるポート。"" は scheme の既定のポート。公開の記事は 80・443 で配信され、それ以外のポートへの取得を踏み台にさせない */
const allowedPorts = new Set(["", "80", "443"]);

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

/**
 * 公開のインターネットで到達できない IPv6 なら true を返す: 未指定・ループバック・ユニークローカル・リンクローカル・
 * 廃止されたサイトローカル (fec0::/10)・マルチキャスト、および IPv4 を埋め込んだ形式 (射影 ::ffff:0:0/96・互換 ::/96・
 * NAT64 の 64:ff9b::/96・6to4 の 2002::/16) のうち埋め込んだ IPv4 が非公開のもの
 */
function isBlockedIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) {
    return true;
  }
  const embeddedIpv4 = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff];
  const [first, second, , , , sixth, seventh, eighth] = groups;
  const upperFiveZero = groups.slice(0, 5).every((group) => group === 0);
  if (upperFiveZero && (sixth === 0 || sixth === 0xffff)) {
    // 未指定 (::)・ループバック (::1) も、埋め込んだ IPv4 が 0.0.0.0・0.0.0.1 として拒否される
    return isBlockedIpv4(embeddedIpv4(seventh, eighth));
  }
  if (first === 0x64 && second === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return isBlockedIpv4(embeddedIpv4(seventh, eighth));
  }
  if (first === 0x2002) {
    return isBlockedIpv4(embeddedIpv4(second, groups[2]));
  }
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00;
}

/** URL が正規化した IPv6 の表記 (16 進、:: で省略可) を 8 つの 16 ビットの数に展開する。展開できなければ undefined を返す */
function expandIpv6(address: string): number[] | undefined {
  const [head, tail, ...rest] = address.split("::");
  if (rest.length > 0) {
    return undefined;
  }
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeroCount = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array<string>(Math.max(zeroCount, 0)).fill("0"), ...tailGroups];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return undefined;
  }
  return groups.map((group) => parseInt(group, 16));
}
