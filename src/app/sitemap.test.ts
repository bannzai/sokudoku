import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("sitemap", () => {
  it("公開ページを basePath を含む絶対 URL で並べる", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      "https://bannzai.github.io/sokudoku/",
      "https://bannzai.github.io/sokudoku/terms/",
      "https://bannzai.github.io/sokudoku/privacy/",
    ]);
  });
});

describe("robots", () => {
  it("sitemap の絶対 URL を指す", () => {
    expect(robots().sitemap).toBe("https://bannzai.github.io/sokudoku/sitemap.xml");
  });
});
