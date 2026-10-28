import Foundation

// URL からの取り込み。ページの URL を、URL から本文を取り出す Worker (worker/) の GET /extract?url=<URL> に渡し、
// 返ってきた本文 ({ title, text, siteName?, lang? }) を貼り付けと同じ経路で読む本文にする。Web 版の src/lib/urlImport.ts と同じ規則。
// Worker に送るのはページの URL だけで、本文も読書位置も送らない (documents/adr/0004-url-import-through-cloudflare-worker.md・0006)

/// URL から本文を取り込めなかった理由。rawValue は Worker が { error } で返す値 (worker/src/index.ts の ExtractError) と同じで、
/// network (Worker から応答を受け取れない) と empty (本文が空) だけは端末側で決める。
public enum URLImportFailure: String, Error, Equatable, CaseIterable {
    case invalidURL = "invalid-url"
    case blockedURL = "blocked-url"
    case robotsDisallowed = "robots-disallowed"
    case pageTooLarge = "page-too-large"
    case pageUnavailable = "page-unavailable"
    case unextractable
    case rateLimited = "rate-limited"
    case network
    case empty

    /// 利用者に見せる文言。Web 版の importFailureMessages (src/lib/importText.ts) と同じ。
    public var message: String {
        switch self {
        case .invalidURL: "http:// か https:// で始まる URL を入力してください"
        case .blockedURL: "この URL のページは読み込めません"
        case .robotsDisallowed: "このサイトは自動での取得を許可していないため読み込めません"
        case .pageTooLarge: "ページが大きすぎて読み込めません"
        case .pageUnavailable: "ページを取得できませんでした (ログインが必要なページや有料のページは読めません)"
        case .unextractable: "このページから本文を取り出せませんでした"
        case .rateLimited: "読み込みが続いたため 1 分ほど待ってから試してください"
        case .network: "取得用のサーバーから応答を受け取れませんでした"
        case .empty: "本文が空です"
        }
    }
}

/// Worker が { error } で返す理由のうち、利用者に見せる文言があるもの。Worker の設定の誤りで返る forbidden-origin・not-found 等は含めない
private let workerExtractErrors: Set<URLImportFailure> = [
    .invalidURL, .blockedURL, .robotsDisallowed, .pageTooLarge, .pageUnavailable, .unextractable, .rateLimited,
]

/// Worker の呼び出しの時間の上限 (秒)。Worker 自身の取得の上限 (10 秒、worker/src/index.ts) と LLM に区切らせる時間の上限
/// (10 秒、worker/src/segment.ts) に、端末と Worker の間の通信の余裕を足した値 (Web 版と同じ)
public let extractTimeoutSeconds: TimeInterval = 30

/// URL の query の値に、そのまま置いてよい文字 (RFC 3986 の unreserved)。
/// URLComponents.queryItems は + を符号化せず、Worker の searchParams.get が + を空白として読むため、これ以外の文字はすべて符号化する
private let queryValueAllowedCharacters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

/// Worker の呼び出しに使う URLSession。Cookie・キャッシュを持たない ephemeral にし、レスポンスを読み終えるまでの時間に上限を置く
/// (URLRequest.timeoutInterval は通信が途切れている時間の上限で、少しずつ届き続ける応答を打ち切れないため)。
public let extractURLSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForResource = extractTimeoutSeconds
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    return URLSession(configuration: configuration)
}()

/// 入力されたページの URL から、Worker の GET /extract を呼ぶリクエストを作る。extractEndpoint は Worker のオリジン。
/// http(s) でない・ホストの無い入力は invalidURL、認証情報付きの URL は Worker へパスワードを送らないよう blockedURL にする (Worker も取得しない)。
/// ページ内の位置 (#...) は取得に使わないため除く。
public func extractRequest(pageURLInput: String, extractEndpoint: URL) -> Result<URLRequest, URLImportFailure> {
    guard let pageURL = URL(string: pageURLInput.trimmingCharacters(in: .whitespacesAndNewlines)),
          var pageURLComponents = URLComponents(url: pageURL, resolvingAgainstBaseURL: false),
          let scheme = pageURLComponents.scheme?.lowercased(), scheme == "http" || scheme == "https",
          let host = pageURLComponents.host, !host.isEmpty
    else {
        return .failure(.invalidURL)
    }
    if pageURLComponents.user != nil || pageURLComponents.password != nil {
        return .failure(.blockedURL)
    }
    pageURLComponents.fragment = nil
    guard let pageURLText = pageURLComponents.url?.absoluteString,
          let encodedPageURL = pageURLText.addingPercentEncoding(withAllowedCharacters: queryValueAllowedCharacters),
          let extractURL = URL(string: "/extract", relativeTo: extractEndpoint),
          var extractURLComponents = URLComponents(url: extractURL, resolvingAgainstBaseURL: true)
    else {
        return .failure(.invalidURL)
    }
    extractURLComponents.percentEncodedQuery = "url=\(encodedPageURL)"
    guard let requestURL = extractURLComponents.url else {
        return .failure(.invalidURL)
    }
    var request = URLRequest(url: requestURL, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: extractTimeoutSeconds)
    request.httpShouldHandleCookies = false
    return .success(request)
}

/// Worker のレスポンスの status と本文 (JSON) から、読む本文か失敗の理由を返す。
/// 成功ならタイトルを先頭の段落にし、本文の先頭の段落がタイトルの先頭と同じなら見出しを 2 回読ませないよう重ねない。
public func extractedText(statusCode: Int, responseBody: Data) -> Result<String, URLImportFailure> {
    let responseJSON = (try? JSONSerialization.jsonObject(with: responseBody)) as? [String: Any]
    guard (200..<300).contains(statusCode) else {
        if let error = responseJSON?["error"] as? String, let failure = URLImportFailure(rawValue: error), workerExtractErrors.contains(failure) {
            return .failure(failure)
        }
        // Cloudflare が Worker の手前で返した 429 など、{ error } の無い失敗も status から読める範囲で区別する。
        // それ以外は、ページではなく取得用のサーバー側の失敗として出す
        return .failure(statusCode == 429 ? .rateLimited : .network)
    }
    guard let title = (responseJSON?["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
          let articleText = responseJSON?["text"] as? String
    else {
        return .failure(.unextractable)
    }
    // Readability は記事の見出しを本文に残すことがあり、タイトル (<title>) は見出しにサイト名を足した形 (「見出し - サイト名」) が多い
    let firstParagraph = String(articleText.drop(while: \.isWhitespace).prefix(while: { !$0.isNewline }))
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let titleRepeatsFirstParagraph = !firstParagraph.isEmpty && title.hasPrefix(firstParagraph)
    let text = readableText(importedText: title.isEmpty || titleRepeatsFirstParagraph ? articleText : "\(title)\n\n\(articleText)")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? .failure(.empty) : .success(text)
}

/// 入力されたページの URL の本文を Worker から取り込む。send は Worker の呼び出しに使う (test で差し替える)。
/// 接続の失敗・時間の上限での打ち切りは network にする。
public func importFromURL(
    pageURLInput: String,
    extractEndpoint: URL,
    send: (URLRequest) async throws -> (Data, URLResponse) = { try await extractURLSession.data(for: $0) }
) async -> Result<String, URLImportFailure> {
    let request: URLRequest
    switch extractRequest(pageURLInput: pageURLInput, extractEndpoint: extractEndpoint) {
    case .success(let extractRequest):
        request = extractRequest
    case .failure(let failure):
        return .failure(failure)
    }
    guard let (responseBody, response) = try? await send(request), let httpResponse = response as? HTTPURLResponse else {
        return .failure(.network)
    }
    return extractedText(statusCode: httpResponse.statusCode, responseBody: responseBody)
}
