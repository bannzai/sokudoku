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

// 後に句読点・閉じ括弧が続いてもよいひらがなだけの単位 (「して」「ため、」「ある。」)。BudouX が付属的な語を独立させた単位にあたる
const hiraganaOnlyPattern = /^(\p{Script=Hiragana}+)[、。，．！？!?"”’)\]」』）】〕］]*$/u;

// 閉じ括弧・文末記号で始まる単位と、読点類と閉じ括弧だけの単位。前の単位の続きで、単独では読めない。
// 読点類の後に文字が続く単位 (「、そして」) は、結合すると読点の間が消えるため含めない。
// 開き側にも使う ASCII の " と、語の先頭にも来る ASCII の . , は含めない (".NET")
const leadingClosingPattern = /^(?:[。．！？!?」』）)】〕］\]”’]|[、，;；:：][」』）)】〕］\]”’]*$)/u;

const openingBrackets = "（(「『【〔［[“‘";
const closingBrackets = "）)」』】〕］]”’";

// ニンニクの記事の段落 (src/lib/readingUnits.test.ts) で BudouX が独立させた付属的な語は「して」「する」「ため、」「ほか、」「ある」で、
// 句読点を除いてすべてひらがな 2 文字。3 文字までにして、同じ型の「あると」(ニンニクの段落)「つかぬ。」(吾輩は猫である) も含める
const maxAttachedHiraganaLength = 3;

// 同じ段落で「信じられている / ため、」(結合後 10 文字) は結合し、「強壮・スタミナ増進作用が / あると」(15 文字) は結合しない境界。
// BudouX の単位は「吾輩は猫である」の冒頭で最長 11 文字 (ニャーニャー泣いていた)、ニンニクの段落で最長 12 文字で、結合で長い単位を増やさない
const maxHiraganaJoinedLength = 10;

// 括弧の結合で 1 回に読む量を、BudouX が単独で出す最長の単位 (ニンニクの段落で 12 文字) から数文字までにとどめる。
// ニンニクの段落の括弧は結合後 8 文字 (「ニンニクの芽」) で収まる。結合後にこれを超える括弧は割れたままにする
const maxBracketJoinedLength = 15;

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
  // U+2028・U+2029 も段落の区切りにする。japaneseSentencePattern の . がこれらに一致せず、前の本文を取りこぼすため
  for (const paragraph of source.matchAll(/[^\r\n\u2028\u2029]+/g)) {
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
    // 引用文の先頭の略語 (“Dr.) も略語として扱うため、開き引用符・開き括弧を除いて比べる
    if (
      englishSentenceEndPattern.test(word[0]) &&
      !englishAbbreviations.has(word[0].replace(/^["'“‘(\[]+/u, "").toLowerCase())
    ) {
      ranges.push([sentenceStart, word.index + word[0].length]);
      sentenceStart = word.index + word[0].length;
    }
  }
  if (/\S/.test(paragraph.slice(sentenceStart))) {
    ranges.push([sentenceStart, paragraph.length]);
  }
  return ranges;
}

/**
 * 文の中の各単位の範囲 ([開始, 終了) の文内の位置) を返す。空白だけの部分は単位にしない。
 * 日本語は BudouX の区切りを joinAttachedRanges でまとめ直した範囲を返す。
 */
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
  const ranges = chunkBoundaries.slice(1).flatMap((chunkEnd, index) => {
    const chunkStart = chunkBoundaries[index];
    return [...sentence.slice(chunkStart, chunkEnd).matchAll(/\S+/g)].map(
      (word): [number, number] => [chunkStart + word.index, chunkStart + word.index + word[0].length],
    );
  });
  return language === "ja" ? joinAttachedRanges(sentence, ranges) : ranges;
}

/**
 * BudouX の単位の範囲を、文節に近い単位にまとめ直した範囲を返す。品詞を持たないため、文字種と括弧の対応だけで判定する。
 *
 * - ひらがなだけの短い単位 (「して」「ため、」) は前の単位に結合する
 * - 閉じ括弧・句読点で始まる単位は前の単位に結合する
 * - 閉じていない開き括弧を含む単位は、閉じ括弧が現れる単位まで後ろと結合する
 *
 * 結合するのは canJoinRanges を満たし、結合後の長さが上限以下の時だけ。
 */
function joinAttachedRanges(sentence: string, ranges: [number, number][]): [number, number][] {
  const joinedRanges: [number, number][] = [];
  for (let index = 0; index < ranges.length; index++) {
    const [start, end] = ranges[index];
    const previous = joinedRanges.at(-1);
    if (previous && canJoinRanges(sentence, [previous, ranges[index]])) {
      const text = sentence.slice(start, end);
      const joinedLength = codePointLength(sentence.slice(previous[0], end));
      const hiraganaOnly = hiraganaOnlyPattern.exec(text);
      if (
        (leadingClosingPattern.test(text) && joinedLength <= maxBracketJoinedLength) ||
        (hiraganaOnly !== null &&
          codePointLength(hiraganaOnly[1]) <= maxAttachedHiraganaLength &&
          joinedLength <= maxHiraganaJoinedLength)
      ) {
        previous[1] = end;
        continue;
      }
    }
    const current: [number, number] = [start, end];
    joinedRanges.push(current);
    if (unclosedBracketCount(sentence.slice(start, end)) === 0) {
      continue;
    }
    for (let closingIndex = index + 1; closingIndex < ranges.length; closingIndex++) {
      const candidate = sentence.slice(start, ranges[closingIndex][1]);
      if (codePointLength(candidate) > maxBracketJoinedLength) {
        break;
      }
      if (unclosedBracketCount(candidate) === 0) {
        if (canJoinRanges(sentence, ranges.slice(index, closingIndex + 1))) {
          current[1] = ranges[closingIndex][1];
          index = closingIndex;
        }
        break;
      }
    }
  }
  return joinedRanges;
}

/**
 * 並んだ範囲を 1 つの単位に結合してよいかを返す。
 * 間に空白がある範囲は結合しない (単位の start / end を元の文字列の連続した範囲に保ち、日本語の文の中の英単語を 1 語ずつにする ADR 0003 の分け方を崩さないため)。
 * 読点類で終わる範囲の後ろには結合しない (読点の間を元の位置でとるため)。
 */
function canJoinRanges(sentence: string, ranges: [number, number][]): boolean {
  return ranges
    .slice(1)
    .every(
      ([start], index) =>
        ranges[index][1] === start && !commaPattern.test(sentence.slice(ranges[index][0], ranges[index][1])),
    );
}

/** 文字列の中で、対応する閉じ括弧が後ろに無い開き括弧の数を返す。括弧の種類は区別しない。 */
function unclosedBracketCount(text: string): number {
  let count = 0;
  for (const character of text) {
    if (openingBrackets.includes(character)) {
      count++;
    } else if (closingBrackets.includes(character) && count > 0) {
      count--;
    }
  }
  return count;
}

/** 文字列のコードポイントの数を返す。サロゲートペアの漢字を 1 文字と数えるため。 */
function codePointLength(text: string): number {
  return [...text].length;
}

/** UTF-16 のコード単位が下位サロゲートかを返す。 */
function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
