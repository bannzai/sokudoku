import SwiftUI
import UniformTypeIdentifiers

/// 本文を取り込む画面。貼り付けと、端末のテキストファイル (txt) から読み込める。本文は端末の外へ送らない。
struct ImportView: View {
    /// 本文が決まった時に呼ぶ。リーダー画面を開く。
    let open: (String) -> Void

    @State private var text = ""
    @State private var isImportingFile = false
    @State private var importFailureMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("読みたい文章を貼り付けてください")
                            .foregroundStyle(.secondary)
                            .padding(16)
                            .allowsHitTesting(false)
                    }
                }
                .accessibilityIdentifier("sourceTextEditor")

            HStack {
                Button("貼り付け", systemImage: "doc.on.clipboard") {
                    text = UIPasteboard.general.string ?? text
                }
                Button("ファイル", systemImage: "folder") {
                    isImportingFile = true
                }
                Button("見本", systemImage: "text.book.closed") {
                    text = sampleText
                }
                .accessibilityIdentifier("sampleButton")
            }
            .buttonStyle(.bordered)

            if let importFailureMessage {
                Text(importFailureMessage).font(.footnote).foregroundStyle(.red)
            }

            Button {
                open(text)
            } label: {
                Text("読む").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("readButton")

            Text("文章の区切りと再生はすべてこの端末の中で行い、文章を外部へ送りません。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .navigationTitle("sokudoku")
        .fileImporter(isPresented: $isImportingFile, allowedContentTypes: [.plainText]) { result in
            importFailureMessage = nil
            switch result {
            case .success(let url):
                do {
                    text = try readText(url: url)
                } catch {
                    importFailureMessage = "ファイルを読み込めませんでした: \(error.localizedDescription)"
                }
            case .failure(let error):
                importFailureMessage = "ファイルを選べませんでした: \(error.localizedDescription)"
            }
        }
    }
}

/// ファイル選択で選んだテキストファイルを読む。文字コードは UTF-8 を試し、読めなければ Shift_JIS (青空文庫の txt) で読む。
private func readText(url: URL) throws -> String {
    let isSecurityScoped = url.startAccessingSecurityScopedResource()
    defer {
        if isSecurityScoped {
            url.stopAccessingSecurityScopedResource()
        }
    }
    let data = try Data(contentsOf: url)
    if let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .shiftJIS) {
        return text
    }
    throw CocoaError(.fileReadInapplicableStringEncoding)
}

/// 見本の本文。青空文庫の夏目漱石「吾輩は猫である」の冒頭 (著作権の保護期間が満了した作品)。
private let sampleText = """
　吾輩は猫である。名前はまだ無い。
　どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。
"""
