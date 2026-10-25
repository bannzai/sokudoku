import Foundation

// 共有シート (ios/ShareExtension) からアプリへ、共有された文字列・ページの URL を渡す取り決め。拡張とアプリの両方でコンパイルする。
// 拡張は 57 MB の IPADic の辞書を持つ SokudokuCore をリンクしないよう、この取り決めを SokudokuCore に置かない。
// 受け渡しは端末の中のアプリ間の URL (sokudoku://import?...) で行い、端末の外へは送らない (documents/adr/0006-ios-native-app-with-on-device-mecab.md)。
// App Group を使わないのは、署名しないシミュレータ向けのビルド (make build-ios の CODE_SIGNING_ALLOWED=NO) では entitlement が付かず共有の領域を使えないため

/// 共有シートから受けた取り込みの内容。
enum SharedImport: Equatable {
    /// 共有された文字列。取り込み画面の入力欄に入れる。
    case text(String)
    /// 共有されたページの URL。URL からの取り込みを行う。
    case pageURL(String)
}

/// アプリが受ける URL の scheme。ios/project.yml の CFBundleURLSchemes と同じ値。
let sharedImportURLScheme = "sokudoku"

/// 共有された内容を、アプリを開く URL にする。
func makeSharedImportURL(sharedImport: SharedImport) -> URL? {
    let (name, value) = switch sharedImport {
    case .text(let text): ("text", text)
    case .pageURL(let pageURL): ("url", pageURL)
    }
    // 共有された文字列の & = + などで値が切れないよう、RFC 3986 の unreserved 以外をすべて符号化する
    let unreservedCharacters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    guard let encodedValue = value.addingPercentEncoding(withAllowedCharacters: unreservedCharacters) else {
        return nil
    }
    return URL(string: "\(sharedImportURLScheme)://import?\(name)=\(encodedValue)")
}

/// アプリが受けた URL から、共有された内容を取り出す。共有シートからの URL でなければ nil を返す。
func parseSharedImportURL(url: URL) -> SharedImport? {
    guard url.scheme == sharedImportURLScheme, url.host() == "import",
          let queryItem = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first,
          let value = queryItem.value
    else {
        return nil
    }
    switch queryItem.name {
    case "text":
        return .text(value)
    case "url":
        return .pageURL(value)
    default:
        return nil
    }
}
