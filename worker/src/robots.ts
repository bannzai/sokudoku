/** robots.txt の 1 行の規則 (Allow / Disallow) */
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
    const match = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(line.replace(/#.*$/, ""));
    if (!match) {
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2];
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
        groups[groups.length - 1].rules.push({ allow: key === "allow", pattern: value });
      }
    }
  }
  const matchingGroups = groups.filter((group) => group.userAgents.includes(userAgentToken));
  const rules = (matchingGroups.length > 0 ? matchingGroups : groups.filter((group) => group.userAgents.includes("*"))).flatMap(
    (group) => group.rules,
  );
  let decidingRule: RobotsRule | undefined;
  for (const rule of rules) {
    if (
      robotsPatternMatches(rule.pattern, path) &&
      (!decidingRule ||
        rule.pattern.length > decidingRule.pattern.length ||
        (rule.pattern.length === decidingRule.pattern.length && rule.allow))
    ) {
      decidingRule = rule;
    }
  }
  return decidingRule?.allow ?? true;
}

/** robots.txt のパターン (* は任意の文字列、末尾の $ は終端) が path の先頭から一致するかを返す */
function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}
