import SokudokuCore
import SwiftUI

/// EPUB の章の一覧。読み始める章を選ぶ。リーダー画面と入れ替わりで出すため、再生中には出ない (documents/adr/0002-avoid-patented-features-and-drm-import.md)。
struct ChapterListView: View {
    let book: EpubBook
    /// 章を選んだ時に呼ぶ。章の本文でリーダー画面を開く。
    let open: (String) -> Void
    /// 別の文章を読むために、取り込み画面へ戻る。
    let close: () -> Void

    var body: some View {
        // 同じ本文の章が並ぶこともあるため、本文ではなく並びの位置で行を見分ける
        List(Array(book.chapters.enumerated()), id: \.offset) { offset, chapter in
            Button {
                open(chapter.text)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    // 見出しの無い章は本文の先頭の行を題名にしており、段落 1 つ分の長さになり得るため 1 行に収める
                    Text(chapter.title)
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                    Text("\(chapter.text.count) 字")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityIdentifier("chapter-\(offset)")
        }
        .navigationTitle(book.title.isEmpty ? "章を選ぶ" : book.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("別の文章", systemImage: "chevron.backward", action: close)
            }
        }
    }
}
