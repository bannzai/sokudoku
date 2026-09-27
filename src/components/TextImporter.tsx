"use client";

import { type DragEvent, useState } from "react";
import { type ImportResult, importFailureMessages, importFile, importPlainText } from "@/lib/importText";
import styles from "./TextImporter.module.css";

/** 本文の取り込み部品に渡す値 */
type TextImporterProps = {
  /** 取り込めた本文を受け取る。本文はこの部品の外へ渡すだけで、保存も送信もしない */
  onImport: (text: string) => void;
};

/** 本文の貼り付け欄と、txt・EPUB のファイル選択 (ドラッグ & ドロップ可) を並べた取り込み部品 */
export function TextImporter({ onImport }: TextImporterProps) {
  const [pastedText, setPastedText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  /** 取り込みの結果を、成功なら onImport へ渡し、失敗なら理由を表示する */
  function handleImportResult(result: ImportResult) {
    if (result.ok) {
      setErrorMessage(undefined);
      onImport(result.text);
    } else {
      setErrorMessage(importFailureMessages[result.reason]);
    }
  }

  /** 選んだファイルをブラウザ内で読み、本文を取り出す */
  async function importSelectedFile(file: File) {
    handleImportResult(importFile(file.name, new Uint8Array(await file.arrayBuffer())));
  }

  /** ドロップしたファイルのうち先頭の 1 つを読む */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void importSelectedFile(file);
    }
  }

  return (
    <div className={styles.importer}>
      <section className={styles.section}>
        <h2 className={styles.heading}>本文を貼り付ける</h2>
        <textarea
          className={styles.textarea}
          value={pastedText}
          onChange={(event) => setPastedText(event.target.value)}
          placeholder="読みたい文章をここに貼り付け"
          rows={8}
        />
        <button type="button" className={styles.button} onClick={() => handleImportResult(importPlainText(pastedText))}>
          この本文を読む
        </button>
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>ファイルを読み込む</h2>
        <div
          className={isDraggingOver ? `${styles.dropZone} ${styles.dropZoneActive}` : styles.dropZone}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
        >
          <p>txt・EPUB をここにドロップ</p>
          <input
            type="file"
            accept=".txt,.epub,text/plain,application/epub+zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void importSelectedFile(file);
              }
              event.target.value = "";
            }}
          />
          <p className={styles.note}>
            青空文庫の txt は注記とルビを除いて読みます
            <br />
            DRM 付きの電子書籍は読み込めません
          </p>
        </div>
      </section>
      {errorMessage && (
        <p role="alert" className={styles.error}>
          {errorMessage}
        </p>
      )}
    </div>
  );
}
