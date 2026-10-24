import SokudokuCore
import SwiftUI
import UniformTypeIdentifiers

/// 本文を取り込む画面。貼り付けと、端末のファイル (txt・DRM の無い EPUB) から読み込める。本文は端末の外へ送らない。
struct ImportView: View {
    /// 本文が決まった時に呼ぶ。リーダー画面を開く。
    let open: (String) -> Void
    /// EPUB から本を取り出せた時に呼ぶ。章の一覧を開く。
    let openBook: (EpubBook) -> Void

    @State private var text = ""
    @State private var isImportingFile = false
    /// EPUB から章を取り出している間か。
    @State private var isOpeningBook = false
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
                // UIPasteboard を直接読むと iOS が毎回「ペーストを許可」の確認を出すため、確認の要らないシステムの貼り付けボタンを使う
                PasteButton(payloadType: String.self) { strings in
                    text = strings.joined(separator: "\n")
                }
                .labelStyle(.titleAndIcon)
                Button("ファイル", systemImage: "folder") {
                    isImportingFile = true
                }
                // 取り出し中に別の EPUB を選ぶと、後から終わった前の本が章の一覧を上書きするため、終わるまで選ばせない
                .disabled(isOpeningBook)
                Button("見本", systemImage: "text.book.closed") {
                    text = sampleText
                }
                .accessibilityIdentifier("sampleButton")
            }
            .buttonStyle(.bordered)

            if isOpeningBook {
                ProgressView("EPUB を読み込んでいます").font(.footnote)
            }
            if let importFailureMessage {
                Text(importFailureMessage).font(.footnote).foregroundStyle(.red)
            }

            Button {
                // 貼り付け・ファイルのどちらで入れた青空文庫の文章も、ルビ・入力者注・底本情報を除いてから読む
                open(readableText(importedText: text))
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
        .fileImporter(isPresented: $isImportingFile, allowedContentTypes: [.plainText, .epub]) { result in
            importFailureMessage = nil
            switch result {
            case .success(let url) where UTType(filenameExtension: url.pathExtension)?.conforms(to: .epub) == true:
                do {
                    openEpub(data: try readData(url: url))
                } catch {
                    importFailureMessage = "ファイルを読み込めませんでした: \(error.localizedDescription)"
                }
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

    /// EPUB のファイルの中身から章を取り出し、章の一覧を開く。DRM 付きなど読めない時は理由を画面に出す。
    private func openEpub(data: Data) {
        isOpeningBook = true
        Task {
            defer { isOpeningBook = false }
            do {
                // 章の数だけ XHTML を解析するため、長い本でも画面を止めないように別のスレッドで行う
                openBook(try await Task.detached(priority: .userInitiated) { try epubBook(data: data) }.value)
            } catch EpubError.drmProtected {
                importFailureMessage = EpubError.drmProtected.localizedDescription
            } catch {
                importFailureMessage = "EPUB を読み込めませんでした: \(error.localizedDescription)"
            }
        }
    }
}

/// ファイル選択で選んだファイルの中身を読む。ファイル選択で得た URL はアプリの外のファイルのため、読む間だけアクセス権を得る。
private func readData(url: URL) throws -> Data {
    let isSecurityScoped = url.startAccessingSecurityScopedResource()
    defer {
        if isSecurityScoped {
            url.stopAccessingSecurityScopedResource()
        }
    }
    return try Data(contentsOf: url)
}

/// ファイル選択で選んだテキストファイルを読む。文字コードは UTF-8 を試し、読めなければ Shift_JIS (青空文庫の txt) で読む。
private func readText(url: URL) throws -> String {
    let data = try readData(url: url)
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
