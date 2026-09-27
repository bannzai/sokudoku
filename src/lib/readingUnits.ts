import { Parser, jaModel } from "budoux";

/** 文章・単位の言語。日本語は文節、英語は単語を 1 単位にする。 */
export type Language = "ja" | "en";

/** 単位を表示した後にとる間の種類。句読点・文末・段落の終わりだけから決める (ADR 0002)。 */
export type Pause = "none" | "comma" | "sentence" | "paragraph";

/** RSVP で 1 回に表示する単位 (日本語は文節、英語は単語)。 */
export type ReadingUnit = {
  /** 表示する文字列。元の文字列の start から end までの部分と一致する。 */
  text: string;
  /** 元の文字列での開始位置 (UTF-16 のインデックス、この位置を含む)。 */
  start: number;
  /** 元の文字列での終了位置 (UTF-16 のインデックス、この位置を含まない)。 */
  end: number;
  /** 単位の文字種から決めた言語。表示時間の計算で、文字数と単語数のどちらの速度を使うかを決める。 */
  language: Language;
  /** 属する文の番号。全文の先頭の文を 0 とし、segmentText が返す sentences の添字と一致する。 */
  sentenceIndex: number;
  /** この単位を表示した後にとる間の種類。 */
  pause: Pause;
};

/** 全文の中の 1 文。英文の訳の出し入れで、再生中の単位を含む文を取り出すのに使う。 */
export type Sentence = {
  /** 元の文字列での開始位置 (UTF-16 のインデックス、この位置を含む)。 */
  start: number;
  /** 元の文字列での終了位置 (UTF-16 のインデックス、この位置を含まない)。 */
  end: number;
  /** 文が属する段落から判定した言語。 */
  language: Language;
};

/** segmentText の結果。units を先頭から順に表示すると全文を読める。 */
export type SegmentedText = {
  /** 全文の文を、先頭から順に並べたもの。 */
  sentences: Sentence[];
  /** 表示する単位を、先頭から順に並べたもの。 */
  units: ReadingUnit[];
};

const japaneseParser = new Parser(jaModel);

// 仮名・漢字に加え、長音符「ー」や句読点「。、」も Script_Extensions では仮名・漢字に含まれる
const japaneseCharacterPattern =
  /[\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Han}]/u;

// 文末記号の後に閉じ括弧・閉じ引用符が続く場合は、それらまでを 1 文に含める
const japaneseSentencePattern = /.+?(?:[。．！？!?]+[」』）)】〕］"”’]*|$)/gu;

const englishSentenceEndPattern = /[.!?]+["'”’)\]]*$/u;

// ピリオドで終わっても文末ではない英語の略語。文末に置かれることが多い etc. は含めない
const englishAbbreviations = new Set(["mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "vs.", "e.g.", "i.e."]);

const commaPattern = /[、，,;；:：]["'”’)\]」』）】〕］]*$/u;

/** 文字列が日本語の文字 (仮名・漢字) を含むかを返す。 */
function containsJapanese(text: string): boolean {
  return japaneseCharacterPattern.test(text);
}

/**
 * 文字列を読む単位に分割し、各単位の元の文字列での位置・属する文・後にとる間を返す。
 *
 * 改行で区切った各行を段落とし、段落ごとに言語を判定する (仮名・漢字を含めば日本語、含まなければ英語)。
 * 日本語の段落は文末記号で文に分けてから BudouX で文節に分け、文節の中の空白でさらに分ける。
 * 英語の段落は空白で単語に分け、句読点は前の単語に付いたままにする。
 */
export function segmentText(source: string): SegmentedText {
  const sentences: Sentence[] = [];
  const units: ReadingUnit[] = [];
  for (const paragraph of source.matchAll(/[^\r\n]+/g)) {
    const paragraphStart = paragraph.index;
    const paragraphLanguage: Language = containsJapanese(paragraph[0]) ? "ja" : "en";
    const paragraphUnitCount = units.length;
    for (const [sentenceStart, sentenceEnd] of sentenceRanges(paragraph[0], paragraphLanguage)) {
      const sentenceUnits = wordRanges(paragraph[0].slice(sentenceStart, sentenceEnd), paragraphLanguage).map(
        ([wordStart, wordEnd]): ReadingUnit => {
          const start = paragraphStart + sentenceStart + wordStart;
          const text = source.slice(start, paragraphStart + sentenceStart + wordEnd);
          return {
            text,
            start,
            end: start + text.length,
            language: containsJapanese(text) ? "ja" : "en",
            sentenceIndex: sentences.length,
            pause: commaPattern.test(text) ? "comma" : "none",
          };
        },
      );
      if (sentenceUnits.length === 0) {
        continue;
      }
      sentenceUnits[sentenceUnits.length - 1].pause = "sentence";
      sentences.push({
        start: sentenceUnits[0].start,
        end: sentenceUnits[sentenceUnits.length - 1].end,
        language: paragraphLanguage,
      });
      units.push(...sentenceUnits);
    }
    if (units.length > paragraphUnitCount) {
      units[units.length - 1].pause = "paragraph";
    }
  }
  return { sentences, units };
}

/** 段落の中の各文の範囲 ([開始, 終了) の段落内の位置) を返す。英語の文末は単語の末尾の記号で決める。 */
function sentenceRanges(paragraph: string, language: Language): [number, number][] {
  if (language === "ja") {
    return [...paragraph.matchAll(japaneseSentencePattern)].map((sentence): [number, number] => [
      sentence.index,
      sentence.index + sentence[0].length,
    ]);
  }
  const ranges: [number, number][] = [];
  let sentenceStart = 0;
  for (const word of paragraph.matchAll(/\S+/g)) {
    if (englishSentenceEndPattern.test(word[0]) && !englishAbbreviations.has(word[0].toLowerCase())) {
      ranges.push([sentenceStart, word.index + word[0].length]);
      sentenceStart = word.index + word[0].length;
    }
  }
  if (/\S/.test(paragraph.slice(sentenceStart))) {
    ranges.push([sentenceStart, paragraph.length]);
  }
  return ranges;
}

/** 文の中の各単位の範囲 ([開始, 終了) の文内の位置) を返す。空白だけの部分は単位にしない。 */
function wordRanges(sentence: string, language: Language): [number, number][] {
  const chunkBoundaries =
    language === "ja"
      ? [
          0,
          // サロゲートペアの間で区切ると文字が壊れるため、下位サロゲートの直前の境界は使わない
          ...japaneseParser
            .parseBoundaries(sentence)
            .filter((boundary) => !isLowSurrogate(sentence.charCodeAt(boundary))),
          sentence.length,
        ]
      : [0, sentence.length];
  return chunkBoundaries.slice(1).flatMap((chunkEnd, index) => {
    const chunkStart = chunkBoundaries[index];
    return [...sentence.slice(chunkStart, chunkEnd).matchAll(/\S+/g)].map(
      (word): [number, number] => [chunkStart + word.index, chunkStart + word.index + word[0].length],
    );
  });
}

/** UTF-16 のコード単位が下位サロゲートかを返す。 */
function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
