import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootLayout from "./layout";

// next/font/google は Next.js のビルド時の変換が無いと呼べず、vitest では読み込めないため、書体の class 名を空にする
vi.mock("./fonts", () => ({ fontVariableClassNames: "" }));

describe("RootLayout の Cloudflare Web Analytics の beacon", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("site token があるビルドでは beacon の script を 1 つだけ入れ、token を data-cf-beacon に載せる", () => {
    vi.stubEnv("CLOUDFLARE_WEB_ANALYTICS_TOKEN", "test-site-token");
    const html = renderToStaticMarkup(<RootLayout>{null}</RootLayout>);
    expect(html.match(/beacon\.min\.js/g)).toHaveLength(1);
    expect(html).toContain('data-cf-beacon="{&quot;token&quot;:&quot;test-site-token&quot;}"');
  });

  it("site token が無いビルドでは beacon の script を入れない", () => {
    vi.stubEnv("CLOUDFLARE_WEB_ANALYTICS_TOKEN", "");
    expect(renderToStaticMarkup(<RootLayout>{null}</RootLayout>)).not.toContain("beacon.min.js");
  });
});
