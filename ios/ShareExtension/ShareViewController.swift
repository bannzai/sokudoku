import UIKit
import UniformTypeIdentifiers

/// 共有シートで sokudoku を選んだ時に開く画面。共有されたページの URL か文字列を、アプリを開く URL (SharedImport.swift) にしてアプリへ渡し、すぐ閉じる。
/// 拡張の中では本文を取得・保存せず、端末の外へも送らない。
final class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task {
            if let sharedImport = await loadSharedImport(), let url = makeSharedImportURL(sharedImport: sharedImport) {
                openContainingApp(url: url)
            }
            extensionContext?.completeRequest(returningItems: nil)
        }
    }

    /// 共有された項目から取り込む内容を取り出す。Safari はページの URL とタイトルの文字列を一緒に渡すことがあるため、Web の URL を文字列より先に見る。
    private func loadSharedImport() async -> SharedImport? {
        let attachments = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        for attachment in attachments where attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try? await attachment.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
               url.scheme == "http" || url.scheme == "https" {
                return .pageURL(url.absoluteString)
            }
        }
        for attachment in attachments where attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try? await attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                return .text(text)
            }
        }
        return nil
    }

    /// 拡張を含むアプリを url で開く。共有の拡張には extensionContext.open が使えず (Today の拡張・iMessage の拡張だけが対象)、
    /// UIApplication.shared も参照できないため、responder の連なりを辿って UIApplication に開かせる。
    /// UIApplication.open を拡張から呼ぶため、この target は APPLICATION_EXTENSION_API_ONLY を NO にしている (ios/project.yml)
    private func openContainingApp(url: URL) {
        var responder: UIResponder? = self
        while let currentResponder = responder {
            if let application = currentResponder as? UIApplication {
                application.open(url)
                return
            }
            responder = currentResponder.next
        }
    }
}
