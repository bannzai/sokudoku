import SokudokuCore
import SwiftUI

/// sokudoku の iOS アプリ。本文の分割・再生・読書位置の保存はすべて端末の中で行い、本文を端末の外へ送らない (documents/adr/0006-ios-native-app-with-on-device-mecab.md)。
/// 例外は URL からの取り込みで、ページの URL だけを Worker へ送る。
@main
struct SokudokuApp: App {
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if let screenshot = appStoreScreenshotLaunchArguments() {
                AppStoreScreenshotPage(page: screenshot.page, language: screenshot.language)
            } else {
                RootView()
            }
            #else
            RootView()
            #endif
        }
    }
}

/// 取り込み画面・章の一覧・リーダー画面を切り替える。リーダーで読む本文が決まるまでは、EPUB を開いていれば章の一覧を、開いていなければ取り込み画面を出す。
/// 共有シートから文字列・URL を受けたら、読んでいる途中や章の一覧を出している間でも取り込み画面に戻して取り込む。
struct RootView: View {
    @State private var reader: ReaderModel?
    /// 開いている EPUB。リーダーから戻った時に章の一覧を出すため、リーダーを開いている間も持つ。
    @State private var book: EpubBook?
    /// 共有シートから受け、取り込み画面がまだ取り込んでいない内容。
    @State private var pendingSharedImport: SharedImport?

    var body: some View {
        NavigationStack {
            if let reader {
                ReaderView(reader: reader, closeTitle: book == nil ? "別の文章" : "章の一覧", close: { self.reader = nil })
            } else if let book {
                ChapterListView(book: book, open: { reader = ReaderModel(source: $0) }, close: { self.book = nil })
            } else {
                ImportView(pendingSharedImport: $pendingSharedImport, open: { reader = ReaderModel(source: $0) }, openBook: { book = $0 })
            }
        }
        .tint(Palette.accent)
        .onOpenURL { url in
            guard let sharedImport = parseSharedImportURL(url: url) else {
                return
            }
            reader = nil
            book = nil
            pendingSharedImport = sharedImport
        }
    }
}

/// 画面の配色。Web 版のデザイントークン (src/app/globals.css) と同じ方向で、長く読んでも眩しくない地と青みの墨色、アクセントは藍色 1 色にする。
enum Palette {
    static let accent = Color(red: 0.20, green: 0.27, blue: 0.53)
    static let highlight = Color(red: 0.20, green: 0.27, blue: 0.53).opacity(0.15)
    static let guide = Color.secondary.opacity(0.35)
}
