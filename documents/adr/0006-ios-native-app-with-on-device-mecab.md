# 0006. iOS ネイティブアプリを SwiftUI で作り、文節は端末内の MeCab (IPADic) の品詞で組み立てる

## Status
Accepted

## Context
- bannzai が、商用利用できる形で iOS のネイティブアプリとして配布する方向を決めた (2026-10-05「iOSのネイティブアプリで考えている」、2026-10-18「iOSの実装を開始よろしく。とりあえずローカルファーストでいいよ」)
- Web 版の文節分割 (BudouX + 後処理、ADR 0003) は品詞を持たないため、付属語の独立・括弧の割れが残る。ADR 0003 が形態素解析を落とした理由は「辞書をブラウザへ配ると重い」で、ネイティブアプリでは辞書をアプリに同梱できるため、その理由が当たらない
- 2026-10-07 に同じ段落 (Wikipedia「ニンニク」の冒頭) で比べた候補:
  - Apple の Foundation Models (端末内 LLM) は、段落によって本文の文字を足す・消すことがあり (`tmp/local-check/fm-segment-3.log` で 7 文中 5 文が本文と一致しなかった)、bannzai が見送ると決めた
  - Apple の NaturalLanguage (NLTagger) は日本語の品詞を返さない (`NLTagger.availableTagSchemes(for: .word, language: .japanese)` が Language・Script・TokenType だけを返した)
  - サーバーの LLM (PR #35 の Workers AI) は本文を端末の外へ出す。iOS 版はまず端末の中で完結させる (ローカルファースト)
- MeCab の Swift 用ラッパー Mecab-Swift (https://github.com/shinjukunian/Mecab-Swift 、MIT。MeCab と IPADic は各々の BSD 系の許諾) は IPADic の辞書を同梱した Swift Package で、README に Furiganify・FuriganaPDF の App Store アプリで使っていると書かれている

## Decision
- iOS アプリは SwiftUI で作り、このリポジトリの `ios/` に置く。Xcode プロジェクトは `ios/project.yml` から xcodegen で生成する
- 本文の区切り・表示時間・読書位置の計算は Swift Package `ios/SokudokuCore` にまとめ、macOS 上の `swift test` で検証する
- 日本語の文節は Mecab-Swift + IPADic の形態素の品詞から組み立てる。自立語で新しい文節を始め、助詞・助動詞・開き括弧以外の記号・非自立語・接尾辞・サ変動詞「する」・名詞の連続・接頭詞と開き括弧の次の語は前の語と同じ文節にする。括弧を閉じる前に切れた文節は、結合後 15 文字までなら閉じ括弧まで結合する (Web 版の maxBracketJoinedLength と同じ上限)
- 段落・文・間の決め方、表示時間の計算、速度の既定値と範囲は Web 版 (`src/lib/readingUnits.ts`・`displayDuration.ts`・`readerState.ts`) と揃える
- 本文は端末の外へ送らず、端末にも保存しない。読書位置は本文の SHA-256 をキーに、速度と一緒に UserDefaults へ保存する (Web 版の readerStorage.ts と同じ方針)
- ADR 0002 の制約 (中央揃え・単色、再生中に全文を出さない、固有名詞で表示時間を延ばさない、DRM 付き書籍を取り込まない) は iOS 版にもそのまま適用する

## Consequences
- アプリの大きさは IPADic の辞書を含めて約 57 MB (2026-10-18 のシミュレータ向け Debug ビルドの `Sokudoku.app` を `du -sh` で計測)
- Mecab-Swift の公開 API は品詞を 8 種類に丸めて返すため、読みと原形の列の位置に読み出したい素性の列を指定する辞書の定義 (`IPADicFeatureColumns`) で品詞細分類と原形を取り出している。Mecab-Swift の版を上げる時は `TextSegmenter.swift` のテストで区切りが変わらないことを確かめる
- IPADic は古い辞書で、「いた事」を 1 語の名詞として持つなど、文節が不自然に切れる箇所が残る (`TextSegmenterTests` のコメント)。UniDic・Sudachi への置き換えは、区切りの崩れが読みの妨げになると分かった時に別の ADR で判断する
- iOS のビルド・テストを行う CI の job はまだ無く、ローカルの `make test-ios`・`make build-ios` で確かめる
- App Store への提出には、ストア上の名前 (「速読術 sokudoku」という別の開発者のアプリが JP ストアにある)・商標・弁理士の確認 (公開前チェックリスト #11) が残る
