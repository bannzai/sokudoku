// 青空文庫のテキストファイルの注記を除き、読む本文だけにする。
// 記法は青空文庫の「注記一覧」( https://www.aozora.gr.jp/annotation/ ) に従う

// 冒頭の【テキスト中に現れる記号について】の区切りと、底本情報の書き出し
const symbolDescriptionHeading = "【テキスト中に現れる記号について】";
const sourceBookLinePrefix = "底本：";

/** 青空文庫の冒頭と記号の説明を挟む、ハイフンだけの区切り行かを返す */
function isSeparatorLine(line: string): boolean {
  return /^-{10,}$/.test(line.trim());
}

/** 青空文庫の書式 (注記・記号の説明・底本情報) を含むテキストかを返す */
export function isAozoraBunkoText(text: string): boolean {
  return (
    text.includes(symbolDescriptionHeading) ||
    text.includes("［＃") ||
    new RegExp(`^${sourceBookLinePrefix}`, "m").test(text)
  );
}

/**
 * 青空文庫のテキストから、冒頭の記号の説明・末尾の底本情報・ルビ (《》と｜)・入力者注 (［＃...］) を除く。
 * 題名と著者名の行は本文の前に残す。外字の注記は注記だけを除き、外字の位置を示す ※ は残す。
 * 改行は LF に揃えたテキストを受け取る
 */
export function stripAozoraBunkoNotation(text: string): string {
  const lines = text.split("\n");
  const headerStart = lines.findIndex(isSeparatorLine);
  const headerEnd = headerStart === -1 ? -1 : lines.findIndex((line, index) => index > headerStart && isSeparatorLine(line));
  const hasSymbolDescription =
    headerEnd !== -1 && lines.slice(headerStart, headerEnd).some((line) => line.includes(symbolDescriptionHeading));
  const footerStart = lines.findLastIndex((line) => line.startsWith(sourceBookLinePrefix));
  const bodyEnd = footerStart === -1 ? lines.length : footerStart;

  return (
    hasSymbolDescription
      ? [...lines.slice(0, headerStart), ...lines.slice(headerEnd + 1, bodyEnd)]
      : lines.slice(0, bodyEnd)
  )
    .join("\n")
    .replace(/［＃[^］]*］/g, "")
    .replace(/《[^》]*》/g, "")
    .replace(/｜/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
