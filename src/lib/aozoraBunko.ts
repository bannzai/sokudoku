// 青空文庫のテキストファイルの注記を除き、読む本文だけにする。
// 記法は青空文庫の「注記一覧」( https://www.aozora.gr.jp/annotation/ ) に従う

// 冒頭の【テキスト中に現れる記号について】の区切りと、底本情報の書き出し
const symbolDescriptionHeading = "【テキスト中に現れる記号について】";
const sourceBookLinePrefix = "底本：";
// 青空文庫のファイルの末尾に必ず入る「このファイルは、インターネットの図書館、青空文庫 (URL) で作られました」の一部。
// 行頭の「底本：」だけでは書評などの引用と見分けられず、それ以降の本文を消してしまうため、この文と揃った時だけ底本情報とみなす
const aozoraBunkoCreditPhrase = "インターネットの図書館、青空文庫";

/**
 * 青空文庫の底本情報の先頭の行の位置を返し、青空文庫の底本情報が無ければ -1 を返す。
 * 上下巻などで底本が複数列記されるため、最初の底本の行から末尾までを底本情報とする
 */
function findSourceBookFooterStart(lines: string[], searchStart: number): number {
  const footerStart = lines.findIndex((line, index) => index >= searchStart && line.startsWith(sourceBookLinePrefix));
  return footerStart !== -1 && lines.slice(footerStart + 1).some((line) => line.includes(aozoraBunkoCreditPhrase))
    ? footerStart
    : -1;
}

/** 青空文庫の冒頭と記号の説明を挟む、ハイフンだけの区切り行かを返す */
function isSeparatorLine(line: string): boolean {
  return /^-{10,}$/.test(line.trim());
}

/**
 * 入力者注 (［＃...］) を除く。外字を含む語への注記 (［＃「※［＃外字の説明］」に傍点］) のように
 * 注記の中に［］が入れ子になるため、括弧の深さを数えて外側の］までを除く
 */
function removeInputterNotes(text: string): string {
  let noteDepth = 0;
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith("［＃", index) || (noteDepth > 0 && text[index] === "［")) {
      noteDepth += 1;
    } else if (noteDepth > 0) {
      if (text[index] === "］") {
        noteDepth -= 1;
      }
    } else {
      result += text[index];
    }
  }
  return result;
}

/** 青空文庫の書式 (注記・記号の説明・青空文庫の作成の文を伴う底本情報) を含むテキストかを返す */
export function isAozoraBunkoText(text: string): boolean {
  return (
    text.includes(symbolDescriptionHeading) ||
    text.includes("［＃") ||
    findSourceBookFooterStart(text.split("\n"), 0) !== -1
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
  const footerStart = findSourceBookFooterStart(lines, hasSymbolDescription ? headerEnd + 1 : 0);
  const bodyEnd = footerStart === -1 ? lines.length : footerStart;

  return removeInputterNotes(
    (hasSymbolDescription
      ? [...lines.slice(0, headerStart), ...lines.slice(headerEnd + 1, bodyEnd)]
      : lines.slice(0, bodyEnd)
    ).join("\n"),
  )
    .replace(/《[^》]*》/g, "")
    .replace(/｜/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
