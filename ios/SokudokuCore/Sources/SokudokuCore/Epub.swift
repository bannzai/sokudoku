import Foundation

// DRM の無い EPUB から、spine の順に章ごとの本文を取り出す。ZIP の展開と XML の解析は Foundation だけで行い、依存を足さない。
// 形式は EPUB 3.3 ( https://www.w3.org/TR/epub-33/ ) の OCF (container.xml・encryption.xml) と Package Document (OPF) に従う

/// EPUB から取り出した 1 冊の本。
public struct EpubBook: Equatable, Sendable {
    /// 本の題名 (OPF の dc:title)。無ければ空文字。
    public let title: String
    /// 読む順 (spine の順) に並べた章。本文の無い文書 (表紙の画像だけ等) は含めない。
    public let chapters: [EpubChapter]
}

/// EPUB の 1 章。spine の 1 文書に当たる。
public struct EpubChapter: Equatable, Sendable {
    /// 章の題名。文書の最初の見出し (h1〜h6) で、見出しが無ければ本文の先頭の行。
    public let title: String
    /// 章の本文。見出し・段落は改行で区切り、ルビは本文だけを残す。
    public let text: String
}

/// EPUB を読めなかった理由。
public enum EpubError: Error, Equatable {
    /// 本文の文書が暗号化されている (DRM 付き)。documents/adr/0002-avoid-patented-features-and-drm-import.md により取り込まない
    case drmProtected
    /// ZIP・container.xml・OPF・本文の XHTML のどれかを読めない。値は読めなかったものの説明。
    case unreadable(String)
}

extension EpubError: LocalizedError {
    /// 取り込み画面に出す理由。
    public var errorDescription: String? {
        switch self {
        case .drmProtected: "DRM 付きの書籍は読めません"
        case .unreadable(let reason): reason
        }
    }
}

/// EPUB のファイルの中身から本を取り出す。本文の文書が暗号化されていれば `EpubError.drmProtected` を投げる。
public func epubBook(data: Data) throws -> EpubBook {
    let archive = try zipEntries(data: data)
    let containerXML = try archive.read(path: "META-INF/container.xml")
    guard let packagePath = parseXML(containerXML, delegate: ContainerParser()).packagePath else {
        throw EpubError.unreadable("META-INF/container.xml に OPF の場所がありません")
    }
    let package = parseXML(try archive.read(path: packagePath), delegate: PackageParser())
    let spinePaths = package.spineIDs.compactMap { id in
        package.manifest[id].flatMap { item in
            item.isNavigation ? nil : resolvedPath(href: item.href, baseFilePath: packagePath)
        }
    }
    if archive.contains(path: "META-INF/encryption.xml") {
        // フォントの難読化 (IDPF・Adobe) もここに書かれるため、本文の文書が暗号化されている時だけ DRM 付きとみなす
        let encryptedPaths = Set(parseXML(try archive.read(path: "META-INF/encryption.xml"), delegate: EncryptionParser()).cipherReferences.compactMap {
            resolvedPath(href: $0, baseFilePath: "")
        })
        if spinePaths.contains(where: encryptedPaths.contains) {
            throw EpubError.drmProtected
        }
    }
    let chapters = try spinePaths.compactMap { path -> EpubChapter? in
        let document = try xhtmlDocument(data: archive.read(path: path), path: path)
        guard let firstLine = document.text.split(separator: "\n").first else {
            return nil
        }
        return EpubChapter(title: document.firstHeading?.replacingOccurrences(of: "\n", with: " ") ?? String(firstLine), text: document.text)
    }
    guard !chapters.isEmpty else {
        throw EpubError.unreadable("本文のある章がありません")
    }
    return EpubBook(title: package.title ?? "", chapters: chapters)
}

/// 文書のパス (コンテナのルートから) を基準に、href を percent-decode・`..` の解決・`#` 以降の除去をしたコンテナのルートからのパスにする。
/// `baseFilePath` が空ならコンテナのルートを基準にする (encryption.xml の URI)。
private func resolvedPath(href: String, baseFilePath: String) -> String? {
    guard let base = URL(string: "epub:///" + (baseFilePath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "")),
          let url = URL(string: href, relativeTo: base)
    else {
        return nil
    }
    return String(url.standardized.path.dropFirst())
}

// MARK: - ZIP

/// ZIP の中央ディレクトリの 1 項目。読み出しに必要な値だけを持つ。
private struct ZipEntry {
    /// 圧縮方式。0 は無圧縮、8 は deflate。
    let method: UInt16
    /// ZIP に入っている (圧縮後の) バイト数。
    let compressedSize: Int
    /// 展開した後のバイト数。展開が途中で切れていないかを確かめるのに使う。
    let uncompressedSize: Int
    /// ローカルヘッダーの位置 (ファイルの先頭から)。
    let localHeaderOffset: Int
}

/// ZIP のファイルの中身と、パスごとの中央ディレクトリの項目。
private struct ZipArchive {
    /// ZIP のファイル全体。
    let bytes: [UInt8]
    /// ZIP の中のパスごとの項目。
    let entries: [String: ZipEntry]

    /// パスの項目が ZIP にあるかを返す。
    func contains(path: String) -> Bool {
        entries[path] != nil
    }

    /// パスの項目を展開した中身を返す。
    func read(path: String) throws -> Data {
        guard let entry = entries[path] else {
            throw EpubError.unreadable("\(path) がありません")
        }
        // データの開始位置は、中央ディレクトリではなくローカルヘッダー自身のファイル名・拡張フィールドの長さで決まる (両者は異なり得る)
        let header = entry.localHeaderOffset
        guard header + 30 <= bytes.count, readUInt32(bytes, header) == 0x0403_4B50 else {
            throw EpubError.unreadable("\(path) のローカルヘッダーを読めません")
        }
        let start = header + 30 + Int(readUInt16(bytes, header + 26)) + Int(readUInt16(bytes, header + 28))
        guard start + entry.compressedSize <= bytes.count else {
            throw EpubError.unreadable("\(path) が途中で切れています")
        }
        let compressed = Data(bytes[start..<(start + entry.compressedSize)])
        switch entry.method {
        case 0:
            return compressed
        case 8:
            // NSData の .zlib はヘッダーの無い raw DEFLATE を扱い、ZIP の圧縮方式 8 と同じ形式
            guard let inflated = try? (compressed as NSData).decompressed(using: .zlib) as Data, inflated.count == entry.uncompressedSize else {
                throw EpubError.unreadable("\(path) を展開できません")
            }
            return inflated
        default:
            throw EpubError.unreadable("\(path) の圧縮方式 (\(entry.method)) に対応していません")
        }
    }
}

/// ZIP の末尾の End of Central Directory から中央ディレクトリを読み、パスごとの項目を返す。ZIP64 と暗号化した ZIP は扱わない。
private func zipEntries(data: Data) throws -> ZipArchive {
    let bytes = [UInt8](data)
    // End of Central Directory は固定長 22 バイトとコメント (最大 65535 バイト) で、ファイルの末尾にある
    let searchStart = max(bytes.count - 22 - 65535, 0)
    guard bytes.count >= 22,
          let end = stride(from: bytes.count - 22, through: searchStart, by: -1).first(where: { readUInt32(bytes, $0) == 0x0605_4B50 })
    else {
        throw EpubError.unreadable("ZIP の形式ではありません")
    }
    let entryCount = Int(readUInt16(bytes, end + 10))
    var offset = Int(readUInt32(bytes, end + 16))
    var entries: [String: ZipEntry] = [:]
    for _ in 0..<entryCount {
        guard offset + 46 <= bytes.count, readUInt32(bytes, offset) == 0x0201_4B50 else {
            throw EpubError.unreadable("ZIP の中央ディレクトリを読めません")
        }
        let nameLength = Int(readUInt16(bytes, offset + 28))
        guard offset + 46 + nameLength <= bytes.count else {
            throw EpubError.unreadable("ZIP の中央ディレクトリを読めません")
        }
        let compressedSize = readUInt32(bytes, offset + 20)
        let uncompressedSize = readUInt32(bytes, offset + 24)
        let localHeaderOffset = readUInt32(bytes, offset + 42)
        if [compressedSize, uncompressedSize, localHeaderOffset].contains(0xFFFF_FFFF) {
            throw EpubError.unreadable("ZIP64 の形式に対応していません")
        }
        // 汎用フラグの bit 0 は ZIP 自体の暗号化 (パスワード付き ZIP)
        if readUInt16(bytes, offset + 8) & 1 != 0 {
            throw EpubError.drmProtected
        }
        let nameBytes = bytes[(offset + 46)..<(offset + 46 + nameLength)]
        let name = String(bytes: nameBytes, encoding: .utf8) ?? String(bytes: nameBytes, encoding: .isoLatin1) ?? ""
        entries[name] = ZipEntry(
            method: readUInt16(bytes, offset + 10),
            compressedSize: Int(compressedSize),
            uncompressedSize: Int(uncompressedSize),
            localHeaderOffset: Int(localHeaderOffset)
        )
        offset += 46 + nameLength + Int(readUInt16(bytes, offset + 30)) + Int(readUInt16(bytes, offset + 32))
    }
    return ZipArchive(bytes: bytes, entries: entries)
}

/// ZIP のリトルエンディアンの 2 バイトの整数を、`offset` の位置から読む。範囲は呼び出し側が確かめる。
private func readUInt16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
    UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
}

/// ZIP のリトルエンディアンの 4 バイトの整数を、`offset` の位置から読む。範囲は呼び出し側が確かめる。
private func readUInt32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
    UInt32(readUInt16(bytes, offset)) | UInt32(readUInt16(bytes, offset + 2)) << 16
}

// MARK: - XML

/// XMLParser で解析し、解析を終えた delegate を返す。解析の失敗は delegate が集めた分だけを使う (container.xml・OPF・encryption.xml は値が欠けたら呼び出し側が扱う)。
private func parseXML<Delegate: NSObject & XMLParserDelegate>(_ data: Data, delegate: Delegate) -> Delegate {
    let parser = XMLParser(data: data)
    parser.shouldProcessNamespaces = true
    parser.delegate = delegate
    parser.parse()
    return delegate
}

/// META-INF/container.xml から OPF のパスを読む。
private final class ContainerParser: NSObject, XMLParserDelegate {
    /// 最初の rootfile の full-path (コンテナのルートからの OPF のパス)。
    private(set) var packagePath: String?

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        if elementName == "rootfile", packagePath == nil {
            packagePath = attributes["full-path"]
        }
    }
}

/// OPF の manifest の 1 項目。
private struct ManifestItem {
    /// OPF のパスからの相対の href。
    let href: String
    /// 目次の文書 (properties に nav を含む) か。本文ではないため章にしない。
    let isNavigation: Bool
}

/// OPF から題名・manifest・spine を読む。
private final class PackageParser: NSObject, XMLParserDelegate {
    /// 最初の dc:title の文字列。
    private(set) var title: String?
    /// manifest の id ごとの項目。
    private(set) var manifest: [String: ManifestItem] = [:]
    /// spine の itemref の idref を読む順に並べたもの。linear="no" (本文の流れの外の補助の文書) は含めない。
    private(set) var spineIDs: [String] = []
    /// dc:title を読んでいる間だけ、その中の文字を集める。
    private var titleBuffer: String?

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        switch elementName {
        case "title" where title == nil && namespaceURI == "http://purl.org/dc/elements/1.1/":
            titleBuffer = ""
        case "item":
            if let id = attributes["id"], let href = attributes["href"] {
                manifest[id] = ManifestItem(href: href, isNavigation: (attributes["properties"] ?? "").split(separator: " ").contains("nav"))
            }
        case "itemref" where attributes["linear"] != "no":
            if let idref = attributes["idref"] {
                spineIDs.append(idref)
            }
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        titleBuffer?.append(string)
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        if elementName == "title", let titleBuffer {
            title = titleBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
            self.titleBuffer = nil
        }
    }
}

/// META-INF/encryption.xml から、暗号化された資源の URI を読む。
private final class EncryptionParser: NSObject, XMLParserDelegate {
    /// CipherReference の URI (コンテナのルートからの相対)。
    private(set) var cipherReferences: [String] = []

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        if elementName == "CipherReference", let uri = attributes["URI"] {
            cipherReferences.append(uri)
        }
    }
}

// MARK: - XHTML

/// 本文の XHTML から取り出した、章の本文と最初の見出し。
private struct XHTMLDocument {
    /// 整えた本文。
    let text: String
    /// 最初の見出しの文字。見出しが無い・空なら nil。
    let firstHeading: String?
}

/// HTML の名前付き文字参照のうち XML が定義しないもの。XHTML 1.1 の DOCTYPE の外部 DTD を XMLParser が読まないため未定義のエラーになる。
/// 青空文庫や一般の EPUB の本文で使われる空白・ダッシュ・引用符に絞り、数値の文字参照に置き換えてから解析する
private let htmlNamedEntities: [String: Int] = [
    "nbsp": 0x00A0, "ensp": 0x2002, "emsp": 0x2003, "thinsp": 0x2009,
    "ndash": 0x2013, "mdash": 0x2014, "hellip": 0x2026, "middot": 0x00B7,
    "lsquo": 0x2018, "rsquo": 0x2019, "ldquo": 0x201C, "rdquo": 0x201D,
    "laquo": 0x00AB, "raquo": 0x00BB, "copy": 0x00A9, "reg": 0x00AE, "trade": 0x2122, "times": 0x00D7,
]

/// 本文の XHTML から本文のテキストと最初の見出しを取り出す。解析できなければ `EpubError.unreadable` を投げる。
private func xhtmlDocument(data: Data, path: String) throws -> XHTMLDocument {
    var source = String(decoding: data, as: UTF8.self)
    for (name, codePoint) in htmlNamedEntities {
        source = source.replacingOccurrences(of: "&\(name);", with: "&#\(codePoint);")
    }
    let parser = XMLParser(data: Data(source.utf8))
    parser.shouldProcessNamespaces = true
    let delegate = XHTMLTextParser()
    parser.delegate = delegate
    guard parser.parse() else {
        throw EpubError.unreadable("\(path) を解析できません: \(parser.parserError?.localizedDescription ?? "")")
    }
    return XHTMLDocument(text: normalizedText(delegate.raw), firstHeading: delegate.firstHeading.map(normalizedText).flatMap { $0.isEmpty ? nil : $0 })
}

/// 本文の区切りとして改行を入れる要素。
private let blockElements: Set<String> = [
    "p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "section", "article",
    "header", "footer", "aside", "figure", "figcaption", "pre", "hr", "tr", "dt", "dd", "table", "ul", "ol", "dl",
]
/// 中身を本文にしない要素。rt・rp はルビの読みと括弧で、本文 (親文字) だけを残すために除く
private let skippedElements: Set<String> = ["head", "script", "style", "rt", "rp"]
/// 章の題名にする見出しの要素。
private let headingElements: Set<String> = ["h1", "h2", "h3", "h4", "h5", "h6"]
/// ブロックの区切りの印。ソースの改行と区別するため、本文に現れない段落区切り文字 (U+2029) を使う
private let blockBreak: Character = "\u{2029}"

/// XHTML の本文の文字を集める。ブロックの区切りに `blockBreak` を入れ、ソースの空白・改行はそのまま残す (`normalizedText` で整える)。
private final class XHTMLTextParser: NSObject, XMLParserDelegate {
    /// 集めた本文。
    private(set) var raw = ""
    /// 最初の見出しの文字。見出しが無ければ nil。
    private(set) var firstHeading: String?
    /// 中身を本文にしない要素の入れ子の深さ。0 の時だけ文字を本文にする。
    private var skipDepth = 0
    /// 最初の見出しを読んでいる間だけ、その中の文字を集める。
    private var headingBuffer: String?

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        if skippedElements.contains(elementName) {
            skipDepth += 1
        } else if skipDepth == 0, blockElements.contains(elementName) {
            raw.append(blockBreak)
            if headingElements.contains(elementName), firstHeading == nil, headingBuffer == nil {
                headingBuffer = ""
            }
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if skipDepth == 0 {
            raw.append(string)
            headingBuffer?.append(string)
        }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        if skippedElements.contains(elementName) {
            skipDepth -= 1
        } else if skipDepth == 0, blockElements.contains(elementName), elementName != "br" {
            raw.append(blockBreak)
            if headingElements.contains(elementName), let headingBuffer {
                firstHeading = headingBuffer
                self.headingBuffer = nil
            }
        }
    }
}

/// 集めた本文の空白を整え、ブロックの区切りを改行にする。
/// ソースの改行 (と前後の空白) は、両側が ASCII の文字 (英文の単語の間) なら空白 1 つに、それ以外 (日本語の文字の間) なら何も残さない。
/// 区切りが続いた時は空行 1 つまでにする
private func normalizedText(_ raw: String) -> String {
    raw
        .replacingOccurrences(of: #"(?<=[!-~])[ \t]*[\r\n][ \t\r\n]*(?=[!-~])"#, with: " ", options: .regularExpression)
        .replacingOccurrences(of: #"[ \t]*[\r\n][ \t\r\n]*"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: "[ \t]+", with: " ", options: .regularExpression)
        .split(separator: blockBreak, omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " ")) }
        .joined(separator: "\n")
        .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}
