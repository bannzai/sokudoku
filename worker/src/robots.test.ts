import { describe, expect, it } from "vitest";
import { isAllowedByRobots } from "./robots";

describe("isAllowedByRobots", () => {
  it("規則が無ければ取得してよい", () => {
    expect(isAllowedByRobots("", "sokudoku-extract", "/article")).toBe(true);
  });

  it("* のグループの Disallow に前方一致したパスは取得しない", () => {
    const robotsText = "User-agent: *\nDisallow: /private/\n";
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/private/page")).toBe(false);
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/public/page")).toBe(true);
  });

  it("Disallow: / はすべてを拒否し、値が空の Disallow はすべてを許可する", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /", "sokudoku-extract", "/a")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow:", "sokudoku-extract", "/a")).toBe(true);
  });

  it("製品名が一致するグループがあれば * のグループより優先する (大文字小文字は区別しない)", () => {
    const robotsText = "User-agent: *\nDisallow: /\n\nUser-agent: Sokudoku-Extract\nAllow: /\n";
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/a")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nAllow: /\n\nUser-agent: sokudoku-extract\nDisallow: /\n", "sokudoku-extract", "/a")).toBe(false);
  });

  it("他の製品名だけのグループは使わない", () => {
    expect(isAllowedByRobots("User-agent: GPTBot\nDisallow: /\n", "sokudoku-extract", "/a")).toBe(true);
  });

  it("連続する User-agent 行は 1 つのグループにまとめる", () => {
    const robotsText = "User-agent: GPTBot\nUser-agent: *\nDisallow: /\n";
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/a")).toBe(false);
  });

  it("最も長く一致した規則に従い、同じ長さなら Allow を優先する", () => {
    const robotsText = "User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\n";
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/docs/public/a")).toBe(true);
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/docs/secret")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /a\nAllow: /a\n", "sokudoku-extract", "/a")).toBe(true);
  });

  it("ASCII 以外の文字とパーセントエンコードの表記を揃えてから比べる (RFC 9309 2.2.2)", () => {
    // URL の pathname は ASCII 以外をエンコード済みで渡る
    expect(isAllowedByRobots("User-agent: *\nDisallow: /非公開/\n", "sokudoku-extract", "/%E9%9D%9E%E5%85%AC%E9%96%8B/a")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /%e9%9d%9e%e5%85%ac%e9%96%8b/\n", "sokudoku-extract", "/%E9%9D%9E%E5%85%AC%E9%96%8B/a")).toBe(false);
    // 非予約文字のエンコードで Disallow を避けられない
    expect(isAllowedByRobots("User-agent: *\nDisallow: /private/\n", "sokudoku-extract", "/%70rivate/a")).toBe(false);
    // 予約文字のエンコードは別の文字として扱う
    expect(isAllowedByRobots("User-agent: *\nDisallow: /a/b\n", "sokudoku-extract", "/a%2Fb")).toBe(true);
  });

  it("* を多く並べた規則と一致しない長いパスでも短い時間で判定する", () => {
    const robotsText = `User-agent: *\nDisallow: /${"*a".repeat(30)}*b\n`;
    const start = performance.now();
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", `/${"a".repeat(2000)}`)).toBe(true);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("空白を長く並べた行があっても短い時間で読む", () => {
    const robotsText = `User-agent: x${" ".repeat(500_000)}y\nUser-agent: *\nDisallow: /a\n`;
    const start = performance.now();
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/a")).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("* は空の文字列にも一致し、$ の無い規則は前方一致にする", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /a*b\n", "sokudoku-extract", "/ab")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /a*b\n", "sokudoku-extract", "/axxbyy")).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /a*b$\n", "sokudoku-extract", "/axxbyy")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /a*b$\n", "sokudoku-extract", "/axxbyyb")).toBe(false);
  });

  it("* と末尾の $ を解釈し、コメントを無視する", () => {
    const robotsText = "User-agent: * # すべて\nDisallow: /*.pdf$ # PDF\nDisallow: /search?*q=\n";
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/files/a.pdf")).toBe(false);
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/files/a.pdf.html")).toBe(true);
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/search?lang=ja&q=x")).toBe(false);
  });
});
