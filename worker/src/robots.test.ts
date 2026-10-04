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

  it("* と末尾の $ を解釈し、コメントを無視する", () => {
    const robotsText = "User-agent: * # すべて\nDisallow: /*.pdf$ # PDF\nDisallow: /search?*q=\n";
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/files/a.pdf")).toBe(false);
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/files/a.pdf.html")).toBe(true);
    expect(isAllowedByRobots(robotsText, "sokudoku-extract", "/search?lang=ja&q=x")).toBe(false);
  });
});
