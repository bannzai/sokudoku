import SwiftUI

/// sokudoku の iOS アプリ。本文の分割・再生・読書位置の保存はすべて端末の中で行い、本文を端末の外へ送らない (documents/adr/0006-ios-native-app-with-on-device-mecab.md)。
@main
struct SokudokuApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// 取り込み画面とリーダー画面を切り替える。リーダーで読む本文が決まるまでは取り込み画面を出す。
struct RootView: View {
    @State private var reader: ReaderModel?

    var body: some View {
        NavigationStack {
            if let reader {
                ReaderView(reader: reader, close: { self.reader = nil })
            } else {
                ImportView(open: { reader = ReaderModel(source: $0) })
            }
        }
        .tint(Palette.accent)
    }
}

/// 画面の配色。Web 版のデザイントークン (src/app/globals.css) と同じ方向で、長く読んでも眩しくない地と青みの墨色、アクセントは藍色 1 色にする。
enum Palette {
    static let accent = Color(red: 0.20, green: 0.27, blue: 0.53)
    static let highlight = Color(red: 0.20, green: 0.27, blue: 0.53).opacity(0.15)
    static let guide = Color.secondary.opacity(0.35)
}
