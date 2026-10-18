import SokudokuCore
import SwiftUI

/// リーダー画面。単位を 1 つずつ同じ位置に中央揃えで出し、停止中だけ前後の文と現在位置を出す (documents/adr/0002-avoid-patented-features-and-drm-import.md)。
struct ReaderView: View {
    let reader: ReaderModel
    /// 別の文章を読むために、取り込み画面へ戻る。
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if let failureMessage = reader.failureMessage {
                ContentUnavailableView("読み込めませんでした", systemImage: "exclamationmark.triangle", description: Text(failureMessage))
            } else if reader.segmented == nil {
                ProgressView("文章を区切っています")
                    .frame(maxHeight: .infinity)
            } else {
                unitDisplay
                if !reader.isPlaying {
                    surroundingText
                } else {
                    Spacer()
                }
                controls
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("別の文章", systemImage: "chevron.backward") {
                    reader.pause()
                    close()
                }
            }
            ToolbarItem(placement: .principal) {
                Text(progressText).font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .onDisappear { reader.pause() }
    }

    /// 単位を出す位置。上下の細い縦線の間に、毎回同じ位置へ中央揃えで出す。タップで再生・一時停止する。
    private var unitDisplay: some View {
        VStack(spacing: 12) {
            Rectangle().fill(Palette.guide).frame(width: 1, height: 28)
            Text(reader.currentUnit?.text ?? "")
                .font(.custom("HiraMinProN-W3", size: 40, relativeTo: .largeTitle))
                .lineLimit(1)
                .minimumScaleFactor(0.4)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("currentUnit")
            Rectangle().fill(Palette.guide).frame(width: 1, height: 28)
        }
        .padding(.vertical, 48)
        .padding(.horizontal)
        .contentShape(Rectangle())
        .onTapGesture { reader.togglePlayback() }
    }

    /// 停止中だけ出す、現在の文の前後と現在位置のハイライト。長い本文でも描画が重くならないよう、前後数文に絞る。
    private var surroundingText: some View {
        ScrollView {
            Text(surroundingAttributedText)
                .font(.custom("HiraMinProN-W3", size: 17, relativeTo: .body))
                .lineSpacing(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .background(Color(.secondarySystemBackground))
        .accessibilityIdentifier("surroundingText")
    }

    private var surroundingAttributedText: AttributedString {
        guard let segmented = reader.segmented, let unit = reader.currentUnit else {
            return AttributedString()
        }
        let sentences = segmented.sentences
        let first = sentences[max(unit.sentenceIndex - 2, 0)].start
        let last = sentences[min(unit.sentenceIndex + 4, sentences.count - 1)].end
        let nsSource = reader.source as NSString
        var attributed = AttributedString(nsSource.substring(with: NSRange(location: first, length: last - first)))
        let highlight = NSRange(location: unit.start - first, length: unit.end - unit.start)
        if let range = Range(highlight, in: attributed) {
            attributed[range].backgroundColor = Palette.highlight
            attributed[range].foregroundColor = Palette.accent
        }
        return attributed
    }

    private var controls: some View {
        VStack(spacing: 16) {
            HStack(spacing: 32) {
                Button("前へ", systemImage: "backward.end.fill") { reader.step(by: -1) }
                    .labelStyle(.iconOnly)
                Button(reader.isPlaying ? "一時停止" : "再生", systemImage: reader.isPlaying ? "pause.circle.fill" : "play.circle.fill") {
                    reader.togglePlayback()
                }
                .labelStyle(.iconOnly)
                .font(.system(size: 56))
                .accessibilityIdentifier("playButton")
                Button("次へ", systemImage: "forward.end.fill") { reader.step(by: 1) }
                    .labelStyle(.iconOnly)
            }
            .font(.title2)
            ForEach(reader.languages, id: \.self) { language in
                HStack {
                    Button("遅く", systemImage: "minus") { reader.changeSpeed(language: language, by: -1) }
                        .labelStyle(.iconOnly)
                    Text(speedText(language: language))
                        .font(.callout.monospacedDigit())
                        .frame(minWidth: 140)
                    Button("速く", systemImage: "plus") { reader.changeSpeed(language: language, by: 1) }
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding()
    }

    private func speedText(language: Language) -> String {
        switch language {
        case .ja: "\(reader.speed.japaneseCharactersPerMinute) 文字/分"
        case .en: "\(reader.speed.englishWordsPerMinute) 語/分"
        }
    }

    private var progressText: String {
        guard !reader.units.isEmpty else {
            return ""
        }
        let remaining = Int(reader.remainingSeconds.rounded())
        return "\(reader.index + 1) / \(reader.units.count)・残り \(remaining / 60):\(String(format: "%02d", remaining % 60))"
    }
}
