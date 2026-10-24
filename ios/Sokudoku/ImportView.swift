import SokudokuCore
import SwiftUI
import UniformTypeIdentifiers

/// URL からの取り込みに使う Worker (worker/) のオリジン。Info.plist の SokudokuExtractURL (ビルド設定 SOKUDOKU_EXTRACT_URL、ios/project.yml) が空のビルドでは nil。
private let extractEndpoint = (Bundle.main.object(forInfoDictionaryKey: "SokudokuExtractURL") as? String)
    .flatMap { $0.isEmpty ? nil : URL(string: $0) }

/// 本文を取り込む画面。貼り付けと、端末のテキストファイル (txt) と、共有シートから読み込める。本文は端末の外へ送らない。
/// Worker のオリジンを渡したビルドだけ、ページの URL を Worker へ送って本文を取り出す URL からの取り込みを出す (Web 版と同じ)。
struct ImportView: View {
    /// 共有シートから受けた内容。取り込んだら nil に戻す。
    @Binding var pendingSharedImport: SharedImport?
    /// 本文が決まった時に呼ぶ。リーダー画面を開く。
    let open: (String) -> Void

    @State private var text = ""
    @State private var pageURLInput = ""
    @State private var isImportingFile = false
    @State private var importFailureMessage: String?
    /// 取り込み操作ごとに増やす番号。URL の取得を待つ間に次の操作があった時、古い結果で上書きしないために使う (Web 版の TextImporter と同じ)。
    @State private var latestImportRequestID = 0
    /// 取得中の URL の取り込み操作の番号。取得中でなければ nil。
    @State private var fetchingURLRequestID: Int?

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
                Button("見本", systemImage: "text.book.closed") {
                    text = sampleText
                }
                .accessibilityIdentifier("sampleButton")
            }
            .buttonStyle(.bordered)

            if extractEndpoint != nil {
                HStack {
                    TextField("https://", text: $pageURLInput)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.go)
                        .onSubmit { Task { await importPageURL() } }
                        .accessibilityIdentifier("pageURLField")
                    Button(fetchingURLRequestID != nil ? "取得中" : "URL から読む") {
                        Task { await importPageURL() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(fetchingURLRequestID != nil || pageURLInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("importURLButton")
                }
            }

            if let importFailureMessage {
                Text(importFailureMessage).font(.footnote).foregroundStyle(.red)
            }

            Button {
                latestImportRequestID += 1
                // 貼り付け・ファイルのどちらで入れた青空文庫の文章も、ルビ・入力者注・底本情報を除いてから読む
                open(readableText(importedText: text))
            } label: {
                Text("読む").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("readButton")

            Text("文章の区切りと再生はすべてこの端末の中で行い、文章を外部へ送りません。\(extractEndpoint != nil ? "URL から読む時だけ、ページの URL を取得用のサーバーへ送ります。" : "")")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .navigationTitle("sokudoku")
        .onChange(of: pendingSharedImport, initial: true) {
            guard let sharedImport = pendingSharedImport else {
                return
            }
            pendingSharedImport = nil
            importFailureMessage = nil
            switch sharedImport {
            case .text(let sharedText):
                latestImportRequestID += 1
                text = sharedText
            case .pageURL(let pageURL):
                pageURLInput = pageURL
                if extractEndpoint != nil {
                    Task { await importPageURL() }
                } else {
                    importFailureMessage = "このビルドは URL からの取り込みに対応していません"
                }
            }
        }
        .fileImporter(isPresented: $isImportingFile, allowedContentTypes: [.plainText]) { result in
            importFailureMessage = nil
            latestImportRequestID += 1
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

    /// 入力欄の URL のページの本文を Worker から取り込み、取れたらリーダー画面を開く。取得を待つ間に別の取り込み操作があれば、この結果は捨てる。
    private func importPageURL() async {
        guard let extractEndpoint else {
            return
        }
        latestImportRequestID += 1
        let importRequestID = latestImportRequestID
        fetchingURLRequestID = importRequestID
        importFailureMessage = nil
        let result = await importFromURL(pageURLInput: pageURLInput, extractEndpoint: extractEndpoint)
        // 後から始めた URL の取得 (取得中に共有シートから受けた URL 等) がまだ続いていれば、取得中の表示はそちらに任せる
        if fetchingURLRequestID == importRequestID {
            fetchingURLRequestID = nil
        }
        guard importRequestID == latestImportRequestID else {
            return
        }
        switch result {
        case .success(let importedText):
            open(importedText)
        case .failure(let failure):
            importFailureMessage = failure.message
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
