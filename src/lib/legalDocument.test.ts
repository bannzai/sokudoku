import { describe, expect, it } from "vitest";
import { renderLegalDocument } from "./legalDocument";

describe("renderLegalDocument", () => {
  it("利用規約の markdown を見出し付きの HTML にする", async () => {
    const html = await renderLegalDocument("terms");
    expect(html).toContain("<h1>利用規約</h1>");
  });

  it("プライバシーポリシーに問い合わせ先のメールアドレスが載る", async () => {
    const html = await renderLegalDocument("privacy");
    expect(html).toContain("<h1>プライバシーポリシー</h1>");
    expect(html).toContain("bannzai.app@gmail.com");
  });
});
