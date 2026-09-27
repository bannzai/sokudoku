import { describe, expect, it } from "vitest";
import { isAozoraBunkoText, stripAozoraBunkoNotation } from "./aozoraBunko";

describe("stripAozoraBunkoNotation", () => {
  it("｜で始まりを示したルビと、｜の無いルビを除く", () => {
    expect(stripAozoraBunkoNotation("吾輩《わがはい》は一番｜獰悪《どうあく》な猫")).toBe("吾輩は一番獰悪な猫");
  });

  it("入力者注を除き、外字の位置を示す ※ は残す", () => {
    expect(stripAozoraBunkoNotation("［＃８字下げ］一［＃「一」は中見出し］\n※［＃「言＋墟のつくり」、第4水準2-88-74］の字")).toBe(
      "一\n※の字",
    );
  });

  it("注記の中に外字の注記が入れ子になっていても、外側の注記の終わりまで除く", () => {
    expect(stripAozoraBunkoNotation("※［＃「言＋墟のつくり」、第4水準2-88-74］の字［＃「※［＃「言＋墟のつくり」、第4水準2-88-74］の字」に傍点］です")).toBe(
      "※の字です",
    );
  });

  it("底本が複数列記された底本情報をすべて除く", () => {
    expect(stripAozoraBunkoNotation("本文\n\n底本：「上巻」出版社\n　　　1990年発行\n底本：「下巻」出版社\n入力：（入力者名）")).toBe(
      "本文",
    );
  });

  it("題名と著者名を残し、記号の説明と底本情報を除く", () => {
    const text = [
      "題名",
      "著者",
      "",
      "-------------------------------------------------------",
      "【テキスト中に現れる記号について】",
      "《》：ルビ",
      "-------------------------------------------------------",
      "",
      "本文",
      "",
      "底本：「底本」出版社",
      "入力：（入力者名）",
    ].join("\n");
    expect(stripAozoraBunkoNotation(text)).toBe("題名\n著者\n\n本文");
  });

  it("記号の説明の無いハイフンの区切り行は本文として残す", () => {
    expect(stripAozoraBunkoNotation("前\n----------\n中\n----------\n後")).toBe("前\n----------\n中\n----------\n後");
  });
});

describe("isAozoraBunkoText", () => {
  it("記号の説明・入力者注・底本情報のどれかがあれば青空文庫の書式とみなす", () => {
    expect(isAozoraBunkoText("【テキスト中に現れる記号について】")).toBe(true);
    expect(isAozoraBunkoText("［＃改ページ］")).toBe(true);
    expect(isAozoraBunkoText("本文\n底本：「底本」")).toBe(true);
  });

  it("注記の無いテキストは青空文庫の書式とみなさない", () => {
    expect(isAozoraBunkoText("吾輩は猫である。名前はまだ無い。")).toBe(false);
  });
});
