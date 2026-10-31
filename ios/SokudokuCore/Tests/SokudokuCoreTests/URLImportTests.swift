import Foundation
import XCTest
@testable import SokudokuCore

// Web 版のテスト (src/lib/urlImport.test.ts) と同じ入力で同じ結果になることを確かめる
private let extractEndpoint = URL(string: "https://sokudoku-extract.example.workers.dev")!

/// Worker の成功・失敗のレスポンスの本文を JSON にする
private func jsonBody(_ object: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

/// 成功したリクエストを取り出す。失敗ならテストを失敗にする
private func successfulRequest(pageURLInput: String) throws -> URLRequest {
    try extractRequest(pageURLInput: pageURLInput, extractEndpoint: extractEndpoint).get()
}

/// リクエストの URL の query の url の値 (符号化を解いた値) を返す
private func requestedPageURL(_ request: URLRequest) -> String? {
    URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "url" }?.value
}

final class URLImportTests: XCTestCase {
    func testRequestSendsOnlyThePageURLToExtractEndpoint() throws {
        let request = try successfulRequest(pageURLInput: " https://ja.wikipedia.org/wiki/速読 ")
        let requestURLComponents = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false))
        XCTAssertEqual(requestURLComponents.scheme, "https")
        XCTAssertEqual(requestURLComponents.host, "sokudoku-extract.example.workers.dev")
        XCTAssertEqual(requestURLComponents.path, "/extract")
        XCTAssertEqual(requestURLComponents.queryItems?.map(\.name), ["url"])
        XCTAssertEqual(requestedPageURL(request), "https://ja.wikipedia.org/wiki/%E9%80%9F%E8%AA%AD")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertEqual(request.timeoutInterval, 30)
    }

    func testQueryValueEncodesReservedCharactersSoWorkerReadsTheSameURL() throws {
        // Worker の searchParams.get は + を空白として読むため、+ も符号化されていることを確かめる
        let request = try successfulRequest(pageURLInput: "https://example.com/a?b=1&c=d+e")
        XCTAssertEqual(request.url?.query(percentEncoded: true), "url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3Dd%2Be")
    }

    func testNonHTTPInputIsInvalidURL() {
        for input in ["example.com/article", "ftp://example.com/", "javascript:alert(1)", "", "https://"] {
            XCTAssertEqual(
                extractRequest(pageURLInput: input, extractEndpoint: extractEndpoint).failure,
                .invalidURL,
                "入力: \(input)"
            )
        }
    }

    func testURLWithCredentialsIsBlocked() {
        XCTAssertEqual(
            extractRequest(pageURLInput: "https://alice:secret@example.com/a", extractEndpoint: extractEndpoint).failure,
            .blockedURL
        )
    }

    func testFragmentIsRemoved() throws {
        XCTAssertEqual(requestedPageURL(try successfulRequest(pageURLInput: "https://example.com/a?b=1#note")), "https://example.com/a?b=1")
    }

    func testTitleIsPrependedAsFirstParagraph() {
        XCTAssertEqual(
            extractedText(statusCode: 200, responseBody: jsonBody(["title": "速読の方法", "text": "一段落目。\n\n二段落目。", "lang": "ja"])).success,
            "速読の方法\n\n一段落目。\n\n二段落目。"
        )
        XCTAssertEqual(extractedText(statusCode: 200, responseBody: jsonBody(["title": "", "text": "本文"])).success, "本文")
    }

    func testTitleIsNotRepeatedWhenFirstParagraphIsTheHeading() {
        XCTAssertEqual(
            extractedText(statusCode: 200, responseBody: jsonBody(["title": "Speed reading", "text": "Speed reading\n\nFirst paragraph."])).success,
            "Speed reading\n\nFirst paragraph."
        )
        XCTAssertEqual(
            extractedText(statusCode: 200, responseBody: jsonBody(["title": "速読の方法 - サンプルの百科事典", "text": "速読の方法\n\n一段落目。"])).success,
            "速読の方法\n\n一段落目。"
        )
        // Swift は CRLF を 1 文字として扱うため、CRLF の本文でも先頭の段落で切れることを確かめる
        XCTAssertEqual(
            extractedText(statusCode: 200, responseBody: jsonBody(["title": "速読の方法 - サンプル", "text": "速読の方法\r\n\r\n一段落目。"])).success,
            "速読の方法\n\n一段落目。"
        )
    }

    func testWorkerErrorBecomesFailureReason() {
        let cases: [(Int, URLImportFailure)] = [
            (422, .unextractable), (429, .rateLimited), (400, .blockedURL), (403, .robotsDisallowed), (413, .pageTooLarge), (502, .pageUnavailable),
        ]
        for (statusCode, failure) in cases {
            XCTAssertEqual(extractedText(statusCode: statusCode, responseBody: jsonBody(["error": failure.rawValue])).failure, failure)
        }
    }

    func testFailureWithoutErrorIsRateLimitedOnlyFor429() {
        XCTAssertEqual(extractedText(statusCode: 429, responseBody: Data("<html>error</html>".utf8)).failure, .rateLimited)
        XCTAssertEqual(extractedText(statusCode: 500, responseBody: Data("<html>error</html>".utf8)).failure, .network)
        XCTAssertEqual(extractedText(statusCode: 403, responseBody: jsonBody(["error": "forbidden-origin"])).failure, .network)
    }

    func testUnexpectedShapeIsUnextractableAndBlankIsEmpty() {
        XCTAssertEqual(extractedText(statusCode: 200, responseBody: jsonBody(["text": 1])).failure, .unextractable)
        XCTAssertEqual(extractedText(statusCode: 200, responseBody: jsonBody(["title": " ", "text": " "])).failure, .empty)
    }

    func testExtractSessionKeepsNoCookiesNorCacheAndLimitsTotalTime() {
        XCTAssertEqual(extractURLSession.configuration.timeoutIntervalForResource, 30)
        XCTAssertNil(extractURLSession.configuration.httpCookieStorage)
        XCTAssertNil(extractURLSession.configuration.urlCache)
    }

    func testImportFromURLDoesNotCallWorkerForInvalidURL() async {
        var sentRequestCount = 0
        let result = await importFromURL(pageURLInput: "example.com/article", extractEndpoint: extractEndpoint) { request in
            sentRequestCount += 1
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        XCTAssertEqual(result.failure, .invalidURL)
        XCTAssertEqual(sentRequestCount, 0)
    }

    func testImportFromURLTreatsTimeoutAndNonHTTPResponseAsNetwork() async {
        let timedOut = await importFromURL(pageURLInput: "https://example.com/a", extractEndpoint: extractEndpoint) { _ in
            throw URLError(.timedOut)
        }
        XCTAssertEqual(timedOut.failure, .network)
        let nonHTTP = await importFromURL(pageURLInput: "https://example.com/a", extractEndpoint: extractEndpoint) { request in
            (jsonBody(["title": "", "text": "本文"]), URLResponse(url: request.url!, mimeType: nil, expectedContentLength: 0, textEncodingName: nil))
        }
        XCTAssertEqual(nonHTTP.failure, .network)
    }

    func testImportFromURLReturnsExtractedText() async {
        let result = await importFromURL(pageURLInput: "https://example.com/a", extractEndpoint: extractEndpoint) { request in
            (jsonBody(["title": "見出し", "text": "本文"]), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        XCTAssertEqual(result.success, "見出し\n\n本文")
    }
}

private extension Result {
    /// 成功の値。失敗なら nil
    var success: Success? { try? get() }

    /// 失敗の理由。成功なら nil
    var failure: Failure? {
        guard case .failure(let failure) = self else {
            return nil
        }
        return failure
    }
}
