import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextImporter } from "./TextImporter";

describe("TextImporter の URL からの取り込み", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Worker の URL があるビルドでは URL の入力欄と「URL から読む」ボタンを出す", () => {
    vi.stubEnv("NEXT_PUBLIC_EXTRACT_URL", "https://sokudoku-extract.example.workers.dev");
    const html = renderToStaticMarkup(<TextImporter onImport={() => {}} />);
    expect(html).toContain('id="page-url"');
    expect(html).toContain("URL から読む");
    expect(html).toContain("ページの URL を取得用のサーバーへ送ります");
  });

  it("Worker の URL が無いビルドでは URL の入口を出さない", () => {
    vi.stubEnv("NEXT_PUBLIC_EXTRACT_URL", "");
    const html = renderToStaticMarkup(<TextImporter onImport={() => {}} />);
    expect(html).not.toContain('id="page-url"');
    expect(html).not.toContain("URL から読む");
    expect(html).not.toContain("取得用のサーバー");
  });
});
