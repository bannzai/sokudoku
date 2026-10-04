import { describe, expect, it } from "vitest";
import { checkTargetUrl } from "./targetUrl";

describe("checkTargetUrl", () => {
  it.each(["https://ja.wikipedia.org/wiki/%E9%80%9F%E8%AA%AD", "http://example.com/article?id=1", "https://8.8.8.8/", "https://[2001:4860:4860::8888]/"])(
    "公開の http(s) の URL %s を受け付ける",
    (input) => {
      expect(checkTargetUrl(input)).toMatchObject({ ok: true });
    },
  );

  it.each(["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "example.com", ""])(
    "http(s) でない・URL でない入力 %s を invalid-url にする",
    (input) => {
      expect(checkTargetUrl(input)).toEqual({ ok: false, error: "invalid-url" });
    },
  );

  it.each([
    "http://localhost/",
    "http://localhost:3000/",
    "http://app.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "http://intranet/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:192.168.0.1]/",
    "https://user:pass@example.com/",
  ])("内部向けの名前・非公開のアドレス・認証情報付きの URL %s を blocked-url にする", (input) => {
    expect(checkTargetUrl(input)).toEqual({ ok: false, error: "blocked-url" });
  });

  it.each(["http://172.32.0.1/", "http://11.0.0.1/", "http://192.169.0.1/"])("非公開の範囲の外の IPv4 %s は受け付ける", (input) => {
    expect(checkTargetUrl(input)).toMatchObject({ ok: true });
  });
});
