"use client";

import { useState } from "react";
import { TextImporter } from "@/components/TextImporter";

// 取り出した本文の先頭と末尾を、注記・底本情報が除かれたかを見る分だけ出す
const previewLength = 200;

/** 取り込み部品の確認用の仮ページ。リーダー画面 (/read/) に部品を組み込んだら消す */
export default function ImportCheckPage() {
  const [importedText, setImportedText] = useState<string>();

  return (
    <main>
      <h1>本文の取り込み (確認用)</h1>
      <TextImporter onImport={setImportedText} />
      {importedText !== undefined && (
        <section>
          <h2>取り込んだ本文</h2>
          <p>{Array.from(importedText).length.toLocaleString()} 文字</p>
          <h3>先頭</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{importedText.slice(0, previewLength)}</pre>
          <h3>末尾</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{importedText.slice(-previewLength)}</pre>
        </section>
      )}
    </main>
  );
}
