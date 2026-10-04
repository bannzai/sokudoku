/** robots.txt の 1 行の規則 (Allow / Disallow)。pattern は normalizeRobotsPath で表記を揃えたもの */
type RobotsRule = { allow: boolean; pattern: string };

/**
 * robots.txt の本文から、userAgentToken (小文字の製品名) に当てはまるグループの規則で、path (パスとクエリ) を取得してよいかを返す。
 * 判定は RFC 9309 に従う: 製品名が一致するグループがあればそれを、無ければ * のグループを使い、
 * パターンが最も長く一致した規則に従う (同じ長さなら Allow)。当てはまる規則が無ければ取得してよい
 */
export function isAllowedByRobots(robotsText: string, userAgentToken: string, path: string): boolean {
  const groups: { userAgents: string[]; rules: RobotsRule[] }[] = [];
  let collectingUserAgents = false;
  for (const line of robotsText.split(/\r\n|\r|\n/)) {
    // 相手サイトが書いた行を正規表現の後方の照合にかけると、長い空白の並びで二次時間になるため、区切りの位置で分けて trim する
    const uncommentedLine = line.split("#", 1)[0];
    const separatorIndex = uncommentedLine.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = uncommentedLine.slice(0, separatorIndex).trim().toLowerCase();
    const value = uncommentedLine.slice(separatorIndex + 1).trim();
    if (key === "user-agent") {
      if (!collectingUserAgents) {
        groups.push({ userAgents: [], rules: [] });
        collectingUserAgents = true;
      }
      groups[groups.length - 1].userAgents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && groups.length > 0) {
      collectingUserAgents = false;
      // 値が空の Disallow は「すべて許可」を表すため規則にしない
      if (value !== "") {
        groups[groups.length - 1].rules.push({ allow: key === "allow", pattern: normalizeRobotsPath(value) });
      }
    }
  }
  const matchingGroups = groups.filter((group) => group.userAgents.includes(userAgentToken));
  const rules = (matchingGroups.length > 0 ? matchingGroups : groups.filter((group) => group.userAgents.includes("*"))).flatMap(
    (group) => group.rules,
  );
  const normalizedPath = normalizeRobotsPath(path);
  let decidingRule: RobotsRule | undefined;
  for (const rule of rules) {
    if (
      robotsPatternMatches(rule.pattern, normalizedPath) &&
      (!decidingRule ||
        rule.pattern.length > decidingRule.pattern.length ||
        (rule.pattern.length === decidingRule.pattern.length && rule.allow))
    ) {
      decidingRule = rule;
    }
  }
  return decidingRule?.allow ?? true;
}

/**
 * robots.txt のパターン (* は任意の文字列、末尾の $ は終端) が path の先頭から一致するかを返す。どちらも normalizeRobotsPath で揃えた表記を受け取る。
 * 相手サイトが書いたパターンを正規表現にするとバックトラッキングで CPU 時間を使い切らせられるため、
 * 直前の * の位置だけを覚えて戻る照合 (計算量はパターンと path の長さの積まで) にする
 */
function robotsPatternMatches(pattern: string, path: string): boolean {
  // 末尾に $ が無いパターンは前方一致のため、末尾に * があるのと同じに扱う
  const wildcardPattern = pattern.endsWith("$") ? pattern.slice(0, -1) : `${pattern}*`;
  let patternIndex = 0;
  let pathIndex = 0;
  let lastStarPatternIndex = -1;
  let lastStarPathIndex = 0;
  while (pathIndex < path.length) {
    if (patternIndex < wildcardPattern.length && wildcardPattern[patternIndex] === "*") {
      lastStarPatternIndex = patternIndex;
      lastStarPathIndex = pathIndex;
      patternIndex += 1;
    } else if (patternIndex < wildcardPattern.length && wildcardPattern[patternIndex] === path[pathIndex]) {
      patternIndex += 1;
      pathIndex += 1;
    } else if (lastStarPatternIndex !== -1) {
      // 直前の * が 1 文字多く飲み込んだとして照合し直す
      patternIndex = lastStarPatternIndex + 1;
      lastStarPathIndex += 1;
      pathIndex = lastStarPathIndex;
    } else {
      return false;
    }
  }
  while (patternIndex < wildcardPattern.length && wildcardPattern[patternIndex] === "*") {
    patternIndex += 1;
  }
  return patternIndex === wildcardPattern.length;
}

/**
 * パスの表記を RFC 9309 (2.2.2) の比較の形に揃える: ASCII 以外の文字は UTF-8 のパーセントエンコードにし、
 * パーセントエンコードされた非予約文字 (英数字と -._~) は元の文字に戻し、残りのエンコードの 16 進は大文字にする
 */
function normalizeRobotsPath(value: string): string {
  return value
    .replace(/[^\x00-\x7f]+/g, (characters) => encodeURIComponent(characters))
    .replace(/%([0-9a-f]{2})/gi, (escape, hex: string) => {
      const character = String.fromCharCode(parseInt(hex, 16));
      return /^[A-Za-z0-9\-._~]$/.test(character) ? character : `%${hex.toUpperCase()}`;
    });
}
