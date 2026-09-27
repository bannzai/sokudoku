// 青空文庫のテキストファイルの注記を除き、読む本文だけにする。
// 記法は青空文庫の「注記一覧」( https://www.aozora.gr.jp/annotation/ ) に従う

// 冒頭の【テキスト中に現れる記号について】の区切りと、底本情報の書き出し
const symbolDescriptionHeading = "【テキスト中に現れる記号について】";
const sourceBookLinePrefix = "底本：";

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
  // 上下巻などで底本が複数列記されるため、最初の底本の行から末尾までを底本情報とする
  const footerStart = lines.findIndex(
    (line, index) => index > (hasSymbolDescription ? headerEnd : -1) && line.startsWith(sourceBookLinePrefix),
  );
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
