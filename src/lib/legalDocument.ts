import { readFile } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

// content/legal/ に置く法務ドキュメントのファイル名 (拡張子なし)
export type LegalDocumentName = "terms" | "privacy";

// ビルド時に markdown を HTML にする。静的書き出しのため、実行時にファイルを読む経路は無い
export async function renderLegalDocument(name: LegalDocumentName): Promise<string> {
  return marked.parse(await readFile(path.join(process.cwd(), "content", "legal", `${name}.md`), "utf8"), {
    async: false,
  });
}
