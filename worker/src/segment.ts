/** Workers AI の binding (wrangler.toml の [ai]) のうち、この Worker が使う API */
export type Ai = { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };

/**
 * 段落ごとの区切りの位置。添字は本文 (ExtractedArticle の text) を空行で区切った段落の順と同じ。
 * 各要素は、段落の中で新しい単位が始まる位置 (UTF-16 のインデックス、0 と段落の長さは含まない) を昇順に並べたもの。
 * null は LLM に区切らせなかった・区切りを検証で捨てた段落で、フロントが BudouX で分ける
 */
export type ParagraphBoundaries = (number[] | null)[];

// 区切らせるモデル。https://developers.cloudflare.com/workers-ai/models/ のテキスト生成モデルのうち、Workers Paid プラン専用の印が無く、
// 有効なパラメータが 4B で応答が速い MoE の Gemma 4 を暫定で選んだ。日本語の区切りの品質は Worker の配信後に、
// ニンニクの段落で他の候補と比べて決め直す (issue #32)
const segmentationModel = "@cf/google/gemma-4-26b-a4b-it";

// 仮名・漢字を含む段落だけを区切らせる。英語の段落は空白で単語に分けるため LLM が要らない (src/lib/readingUnits.ts の判定と同じ)
const japaneseCharacterPattern = /[\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Han}]/u;

// 1 記事で区切らせる段落の数の上限。Workers AI のテキスト生成の回数の上限 (アカウント・モデルごとに 1 分あたり 300 回、
// https://developers.cloudflare.com/workers-ai/platform/limits/ ) の中で、1 分に 10 記事を区切らせられる数。
// 区切らせる記事は同じ IP (IPv6 は /64) から 1 分に 2 件、全体で 1 分に 3 件 (最大 90 回) まで (wrangler.toml の SEGMENT_RATE_LIMITER・SEGMENT_GLOBAL_RATE_LIMITER)。
// 利用者は bannzai 自身 (documents/DIRECTION.md の仮説) で、記事を開く頻度は 1 分に数件に収まる
const maxParagraphCount = 30;
// 1 段落の文字数の上限。区切った単位を JSON で返させるため出力は段落の 1.5 倍ほどのトークンになり、maxCompletionTokens に収まる長さにする。
// Wikipedia の段落は 100〜400 文字が大半で、超える段落は BudouX に戻す
const maxParagraphLength = 1_000;
// 1 記事で区切らせる文字数の合計の上限。段落の上限 (30) に Wikipedia の長めの段落 (約 600 文字) を掛けた量で、超えた後ろの段落は BudouX に戻す
const maxTotalLength = 20_000;
// 1 段落の応答のトークンの上限。上限の 1,000 文字の段落を、単位ごとの引用符・区切りの記号を含めて返せる量
const maxCompletionTokens = 4_096;
// 1 単位の文字数 (コードポイント) の上限。BudouX と後処理の単位はニンニクの段落で最長 12 文字、括弧の結合の上限が 15 文字 (src/lib/readingUnits.ts) で、
// その倍の 30 文字を超える単位は区切っていない (文・段落をまとめて返した) 応答として捨てる
const maxUnitLength = 30;
// 単位の先頭に来ない文字。読点・句点・閉じ括弧は前の単位に入れる指示 (systemPrompt) に反し、単独では読めない単位になるため、この文字で始まる単位を含む応答は捨てる
const leadingClosingPattern = /^[、。，．！？!?」』）)】〕］\]”’]/u;
// LLM への問い合わせ全体の時間の上限。ページの取得の上限 (10 秒、src/index.ts) と合わせても、フロントの待ち時間の上限 (30 秒、src/lib/urlImport.ts) に収まる長さ
export const segmentationTimeoutMilliseconds = 10_000;

const systemPrompt = [
  "あなたは日本語の文章を、速読で 1 回に 1 つずつ画面に表示する読みの単位に区切る。",
  "単位は文節か短い句 (目安は 4〜12 文字) にする。助詞・助動詞は前の語と同じ単位に入れる。",
  "読点・句点・閉じ括弧は前の単位に入れ、開き括弧は後ろの単位に入れる。",
  "入力の文字を 1 文字も変えない。足さない、削らない、言い換えない。空白と記号もそのまま残す。",
  'units を先頭から順に連結すると入力と完全に一致するようにし、{"units": ["...", "..."]} の JSON だけを出力する。',
].join("\n");

// Workers AI の Chat Completions 形式の入力の ResponseFormatJSONSchema ({ name, schema }) に合わせる
// (https://raw.githubusercontent.com/cloudflare/workerd/main/types/defines/ai.d.ts )
const responseFormat = {
  type: "json_schema",
  json_schema: {
    name: "reading_units",
    schema: {
      type: "object",
      properties: { units: { type: "array", items: { type: "string" } } },
      required: ["units"],
    },
  },
};

/**
 * 本文の段落のうち日本語の段落を、段落ごとに並列で LLM に区切らせ、段落ごとの区切りの位置を返す。
 * 区切りを連結した文字列が元の段落と一致しない応答・上限を超えた段落・時間の上限までに応答が無い段落・失敗した段落は null にする。
 * 段落も応答も保存・記録しない。timeoutMilliseconds は test で短くする
 */
export async function segmentParagraphs(
  ai: Ai,
  paragraphs: readonly string[],
  timeoutMilliseconds = segmentationTimeoutMilliseconds,
): Promise<ParagraphBoundaries> {
  let remainingCount = maxParagraphCount;
  let remainingLength = maxTotalLength;
  const targets = paragraphs.map((paragraph) => {
    if (
      !japaneseCharacterPattern.test(paragraph) ||
      paragraph.length > maxParagraphLength ||
      remainingCount === 0 ||
      paragraph.length > remainingLength
    ) {
      return false;
    }
    remainingCount -= 1;
    remainingLength -= paragraph.length;
    return true;
  });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMilliseconds);
  });
  try {
    return await Promise.all(
      paragraphs.map((paragraph, index) =>
        targets[index] ? Promise.race([segmentParagraph(ai, paragraph), deadline]) : null,
      ),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 1 つの段落を LLM に区切らせ、検証を通った区切りの位置を返す。失敗・検証に通らない応答は null を返す */
async function segmentParagraph(ai: Ai, paragraph: string): Promise<number[] | null> {
  try {
    return boundariesFromUnits(
      paragraph,
      unitsInResult(
        await ai.run(segmentationModel, {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: paragraph },
          ],
          response_format: responseFormat,
          max_completion_tokens: maxCompletionTokens,
          // 区切りは毎回同じに近い方がよく、言い換えを誘う揺らぎは要らないため
          temperature: 0,
          // Gemma 4 は推論が既定で有効 (ai.d.ts の enable_thinking の @default true)。区切りに推論は要らず、応答が時間の上限に収まるよう切る
          chat_template_kwargs: { enable_thinking: false },
        }),
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Workers AI の応答から units の文字列の配列を取り出す。応答はモデルにより { response } (文字列か JSON の値) か
 * OpenAI 互換の { choices: [{ message: { content } }] } で返る。取り出せなければ undefined を返す
 */
function unitsInResult(result: unknown): unknown {
  const response = (result as { response?: unknown } | null)?.response;
  const content =
    response ?? (result as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  const parsed = typeof content === "string" ? parseJsonText(content) : content;
  return (parsed as { units?: unknown } | null | undefined)?.units;
}

/** モデルが返した文字列を JSON として読む。推論の部分 (<think>…</think>) とコードブロックの囲みは除く。読めなければ undefined を返す */
function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(
      text
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/^\s*```(?:json)?/, "")
        .replace(/```\s*$/, ""),
    );
  } catch {
    return undefined;
  }
}

/**
 * 区切った単位の文字列の配列から、段落の中の区切りの位置を返す。
 * 空の単位・文字列でない要素・maxUnitLength を超える単位・読点や閉じ括弧で始まる単位を含む、または連結した文字列が段落と一致しない
 * (本文の改変・脱落がある) なら null を返す
 */
function boundariesFromUnits(paragraph: string, units: unknown): number[] | null {
  if (
    !Array.isArray(units) ||
    units.length === 0 ||
    !units.every(
      (unit): unit is string =>
        typeof unit === "string" &&
        unit !== "" &&
        [...unit.trim()].length <= maxUnitLength &&
        !leadingClosingPattern.test(unit.trimStart()),
    ) ||
    units.join("") !== paragraph
  ) {
    return null;
  }
  const boundaries: number[] = [];
  let offset = 0;
  for (const unit of units.slice(0, -1)) {
    offset += unit.length;
    boundaries.push(offset);
  }
  return boundaries;
}
