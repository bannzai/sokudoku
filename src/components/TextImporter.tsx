"use client";

import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { type ImportResult, importFailureMessages, importFile, importPlainText } from "@/lib/importText";
import { importFromUrl } from "@/lib/urlImport";
import buttonStyles from "./Button.module.css";
import styles from "./TextImporter.module.css";

/** 本文の取り込み部品に渡す値 */
type TextImporterProps = {
  /** 取り込めた本文を受け取る。本文はこの部品の外へ渡すだけで、保存も送信もしない */
  onImport: (text: string) => void;
};

/**
 * 本文の貼り付け欄と、txt・EPUB のファイル選択 (ドラッグ & ドロップ可) と、URL からの取り込みを並べた取り込み部品。
 * URL からの取り込みは、Worker の URL (NEXT_PUBLIC_EXTRACT_URL) を渡した配信のビルドだけに出す
 */
export function TextImporter({ onImport }: TextImporterProps) {
  // 静的書き出しでビルド時の値に置き換わるよう、process.env の名前をそのまま書く
  const extractEndpoint = process.env.NEXT_PUBLIC_EXTRACT_URL;
  const [pastedText, setPastedText] = useState("");
  const [pageUrlInput, setPageUrlInput] = useState("");
  // 取得中の URL の取り込み操作の番号 (latestImportRequestIdRef の値)。取得中でなければ undefined
  const [fetchingUrlRequestId, setFetchingUrlRequestId] = useState<number>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // 取り込み操作ごとに増やす番号。ファイルの読み込みを待つ間に次の操作があった時、古い結果で上書きしないために使う
  const latestImportRequestIdRef = useRef(0);
  // 見た目をボタンにそろえるため、ファイル選択の input は隠し、「ファイルを選ぶ」ボタンから開く
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 取り込みの結果を、成功なら onImport へ渡し、失敗なら理由を表示する */
  function handleImportResult(result: ImportResult) {
    if (result.ok) {
      setErrorMessage(undefined);
      onImport(result.text);
    } else {
      setErrorMessage(importFailureMessages[result.reason]);
    }
  }

  /** 貼り付けた本文を取り込む。読み込み中のファイルがあれば、その結果より後の操作として扱う */
  function importPastedText() {
    latestImportRequestIdRef.current += 1;
    handleImportResult(importPlainText(pastedText));
  }

  /** 選んだファイルをブラウザ内で読み、本文を取り出す。読み込み中に別の取り込み操作があれば、この結果は捨てる */
  async function importSelectedFile(file: File) {
    latestImportRequestIdRef.current += 1;
    const importRequestId = latestImportRequestIdRef.current;
    let importResult: ImportResult;
    try {
      importResult = importFile(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch {
      // 選んだ後にファイルが変更・削除された時などに、ブラウザがファイルを読めず例外になる
      importResult = { ok: false, reason: "unreadable-file" };
    }
    if (importRequestId === latestImportRequestIdRef.current) {
      handleImportResult(importResult);
    }
  }

  /** 入力した URL のページの本文を Worker から取り込む。取得を待つ間に別の取り込み操作があれば、この結果は捨てる */
  async function importPageUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!extractEndpoint) {
      return;
    }
    latestImportRequestIdRef.current += 1;
    const importRequestId = latestImportRequestIdRef.current;
    setFetchingUrlRequestId(importRequestId);
    const importResult = await importFromUrl(pageUrlInput, extractEndpoint);
    // 後から始めた URL の取得がまだ続いていれば、取得中の表示はそちらに任せる
    setFetchingUrlRequestId((fetchingRequestId) => (fetchingRequestId === importRequestId ? undefined : fetchingRequestId));
    if (importRequestId === latestImportRequestIdRef.current) {
      handleImportResult(importResult);
    }
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
      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.heading}>
            <label htmlFor="pasted-text">本文を貼り付ける</label>
          </h2>
          <textarea
            id="pasted-text"
            className={styles.textarea}
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
            placeholder="読みたい文章をここに貼り付け"
            rows={8}
          />
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
            <p className={styles.dropTitle}>txt・EPUB をここにドロップ</p>
            <button type="button" className={buttonStyles.button} onClick={() => fileInputRef.current?.click()}>
              ファイルを選ぶ
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.epub,text/plain,application/epub+zip"
              hidden
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
      </div>
      {extractEndpoint && (
        <section className={styles.urlSection}>
          <h2 className={styles.heading}>
            <label htmlFor="page-url">URL から読む</label>
          </h2>
          <form className={styles.urlForm} onSubmit={importPageUrl}>
            <input
              id="page-url"
              className={styles.urlInput}
              type="text"
              inputMode="url"
              autoComplete="url"
              value={pageUrlInput}
              onChange={(event) => setPageUrlInput(event.target.value)}
              placeholder="https://"
            />
            <button type="submit" className={buttonStyles.button} disabled={fetchingUrlRequestId !== undefined}>
              {fetchingUrlRequestId !== undefined ? "取得中" : "URL から読む"}
            </button>
          </form>
          <p className={styles.note}>
            公開されている記事の本文を取り出します
            <br />
            ログインが必要なページは読めません
          </p>
        </section>
      )}
      {errorMessage && (
        <p role="alert" className={styles.error}>
          {errorMessage}
        </p>
      )}
      <div className={styles.footer}>
        <p className={styles.privacy}>
          本文はこのブラウザの中だけで処理します。サーバーには送らず、保存もしません。
          {extractEndpoint && "URL から読む時だけ、ページの URL を取得用のサーバーへ送ります。"}
        </p>
        <button type="button" className={`${buttonStyles.button} ${buttonStyles.primary}`} onClick={importPastedText}>
          この本文を読む
        </button>
      </div>
    </div>
  );
}
