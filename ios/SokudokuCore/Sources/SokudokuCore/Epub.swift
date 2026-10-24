import Compression
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
    guard let packagePath = try parseXML(containerXML, path: "META-INF/container.xml", delegate: ContainerParser()).packagePath else {
        throw EpubError.unreadable("META-INF/container.xml に OPF の場所がありません")
    }
    let package = try parseXML(archive.read(path: packagePath), path: packagePath, delegate: PackageParser())
    let spinePaths = try package.spineIDs.compactMap { id -> String? in
        // manifest に無い idref・解決できない href は、章が欠けたまま読み進めないよう読めない EPUB とする (Web 版の src/lib/epub.ts と同じ)
        guard let item = package.manifest[id], let path = resolvedPath(href: item.href, baseFilePath: packagePath) else {
            throw EpubError.unreadable("spine の \(id) の文書がありません")
        }
        return item.isNavigation ? nil : path
    }
    let readPaths = Set(spinePaths + [packagePath, "META-INF/container.xml", "META-INF/encryption.xml"])
    guard readPaths.reduce(0, { $0 + (archive.entries[$1]?.uncompressedSize ?? 0) }) <= maxExtractedBytes else {
        throw EpubError.unreadable("本文が大きすぎます")
    }
    if archive.contains(path: "META-INF/encryption.xml") {
        // フォントの難読化 (IDPF・Adobe) もここに書かれるため、本文の文書が暗号化されている時だけ DRM 付きとみなす
        let encryptedPaths = Set(try parseXML(
            archive.read(path: "META-INF/encryption.xml"), path: "META-INF/encryption.xml", delegate: EncryptionParser()
        ).cipherReferences.compactMap {
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

/// 展開するファイル (container.xml・OPF・encryption.xml・spine の XHTML) の展開後の大きさの合計の上限。Web 版 (src/lib/epub.ts) と同じ値。
/// 長編小説 1 冊でも本文は 50 万字程度で UTF-8 では 1.5 MB、XHTML のマークアップを含めても 10 MB に届かないため、
/// 数倍の余裕を持たせつつ、展開後の大きさを偽った ZIP (zip bomb) で端末のメモリを使い切らない大きさにする
private let maxExtractedBytes = 64 * 1024 * 1024

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
        guard entry.uncompressedSize <= maxExtractedBytes else {
            throw EpubError.unreadable("\(path) が大きすぎます")
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
            // 宣言の大きさで上限を判定しているため、無圧縮の中身が宣言と違えば上限を超え得る。読まずに扱う
            guard entry.compressedSize == entry.uncompressedSize else {
                throw EpubError.unreadable("\(path) の大きさが宣言と一致しません")
            }
            return compressed
        case 8 where compressed.isEmpty:
            throw EpubError.unreadable("\(path) を展開できません")
        case 8:
            // COMPRESSION_ZLIB はヘッダーの無い raw DEFLATE を扱い、ZIP の圧縮方式 8 と同じ形式。
            // 展開先を宣言の大きさ + 1 バイトに固定し、大きさを偽った ZIP でも宣言を超えて確保しない (+1 は宣言を超える中身を見分けるため)
            var inflated = Data(count: entry.uncompressedSize + 1)
            let inflatedCount = inflated.withUnsafeMutableBytes { destination in
                compressed.withUnsafeBytes { source in
                    compression_decode_buffer(
                        destination.bindMemory(to: UInt8.self).baseAddress!, destination.count,
                        source.bindMemory(to: UInt8.self).baseAddress!, source.count,
                        nil, COMPRESSION_ZLIB
                    )
                }
            }
            guard inflatedCount == entry.uncompressedSize else {
                throw EpubError.unreadable("\(path) を展開できません")
            }
            return inflated.prefix(inflatedCount)
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

/// XMLParser で解析し、解析を終えた delegate を返す。途中で壊れた XML は、集めた分だけで読み進めると章などが欠けるため、`EpubError.unreadable` を投げる。
/// `path` はエラーに出す、ZIP の中のファイルのパス。
private func parseXML<Delegate: NSObject & XMLParserDelegate>(_ data: Data, path: String, delegate: Delegate) throws -> Delegate {
    let parser = XMLParser(data: data)
    parser.shouldProcessNamespaces = true
    parser.delegate = delegate
    guard parser.parse() else {
        throw EpubError.unreadable("\(path) を解析できません: \(parser.parserError?.localizedDescription ?? "")")
    }
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

/// 名前付き文字参照 (`&名前;`)。1 は名前。CDATA とコメントの中は文字参照として解釈されないため、名前を取らずに読み飛ばす
private let namedEntityPattern = try! NSRegularExpression(
    pattern: #"<!\[CDATA\[.*?\]\]>|<!--.*?-->|&([A-Za-z][A-Za-z0-9]*);"#,
    options: .dotMatchesLineSeparators
)
/// XML 宣言の encoding の指定。1 は指定より前の XML 宣言。
private let xmlEncodingDeclarationPattern = try! NSRegularExpression(pattern: #"^(\s*<\?xml[^>]*?)\s+encoding\s*=\s*["'][^"']*["']"#)

/// XHTML の DTD が定義する名前付き文字参照 (`htmlNamedEntities`) を数値の文字参照に置き換えた文字列を返す。表に無い名前はそのまま残す。
private func replacingHTMLNamedEntities(_ source: String) -> String {
    let nsSource = source as NSString
    var result = ""
    var copiedEnd = 0
    for match in namedEntityPattern.matches(in: source, range: NSRange(location: 0, length: nsSource.length)) {
        guard match.range(at: 1).location != NSNotFound, let codePoint = htmlNamedEntities[nsSource.substring(with: match.range(at: 1))] else {
            continue
        }
        result += nsSource.substring(with: NSRange(location: copiedEnd, length: match.range.location - copiedEnd)) + "&#\(codePoint);"
        copiedEnd = match.range.location + match.range.length
    }
    return result + nsSource.substring(from: copiedEnd)
}

/// UTF-8 か UTF-16 (BOM 付き) の XML の文書を文字列にして返す。UTF-8 のバイト列にして解析し直すため、XML 宣言の encoding の指定は除く (指定が無ければ UTF-8 として読まれる)。
/// どちらでも読めなければ nil を返す。
private func xmlSource(data: Data) -> String? {
    let hasUTF16ByteOrderMark = data.starts(with: [0xFE, 0xFF]) || data.starts(with: [0xFF, 0xFE])
    guard let decoded = hasUTF16ByteOrderMark ? String(data: data, encoding: .utf16) : String(data: data, encoding: .utf8) else {
        return nil
    }
    // BOM が文字として残ると XML 宣言が文書の先頭に無いことになり、encoding の指定を除けないため外す
    let source = decoded.hasPrefix("\u{FEFF}") ? String(decoded.dropFirst()) : decoded
    return xmlEncodingDeclarationPattern.stringByReplacingMatches(
        in: source,
        range: NSRange(location: 0, length: (source as NSString).length),
        withTemplate: "$1"
    )
}

/// 本文の XHTML から本文のテキストと最初の見出しを取り出す。解析できなければ `EpubError.unreadable` を投げる。
private func xhtmlDocument(data: Data, path: String) throws -> XHTMLDocument {
    // UTF-8 と UTF-16 (XML の仕様で BOM が必須) 以外の文字コードの文書は、文字コードを XML 宣言から XMLParser に判定させるため、置き換えずにそのまま渡す
    let parser = XMLParser(data: xmlSource(data: data).map { Data(replacingHTMLNamedEntities($0).utf8) } ?? data)
    parser.shouldProcessNamespaces = true
    let delegate = XHTMLTextParser()
    parser.delegate = delegate
    guard parser.parse() else {
        throw EpubError.unreadable("\(path) を解析できません: \(parser.parserError?.localizedDescription ?? "")")
    }
    return XHTMLDocument(text: normalizedText(delegate.raw), firstHeading: delegate.firstHeading.map(normalizedText).flatMap { $0.isEmpty ? nil : $0 })
}

/// 本文の区切りとして改行を入れる要素。
/// Web 版 (src/lib/epub.ts) の blockTagNames と同じ要素に、定義リストの dl を足したもの
private let blockElements: Set<String> = [
    "address", "article", "aside", "blockquote", "body", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
    "table", "td", "th", "tr", "ul",
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
    /// pre の入れ子の深さ。pre の中の改行は詩の行などの区切りのため、詰めずに改行として残す (Web 版の src/lib/epub.ts と同じ)。
    private var preformattedDepth = 0
    /// 最初の見出しを読んでいる間だけ、その中の文字を集める。
    private var headingBuffer: String?

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        if elementName == "pre" {
            preformattedDepth += 1
        }
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
            let text = preformattedDepth > 0
                ? string.replacingOccurrences(of: #"\r\n|\r|\n"#, with: String(blockBreak), options: .regularExpression)
                : string
            raw.append(text)
            headingBuffer?.append(text)
        }
    }

    /// CDATA の中の文字も本文にする。XMLParser は CDATA を foundCharacters ではなくこちらで渡す。
    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        self.parser(parser, foundCharacters: String(decoding: CDATABlock, as: UTF8.self))
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        if elementName == "pre" {
            preformattedDepth -= 1
        }
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

/// 日本語の文字 (漢字・ひらがな・カタカナ・全角の記号と句読点・全角形)。ソースの改行を詰めるかの判定に使う。
private let japaneseCharacterClass = #"[\p{Han}\p{Hiragana}\p{Katakana}\x{3000}-\x{303F}\x{FF00}-\x{FFEF}]"#

/// 集めた本文の空白を整え、ブロックの区切りを改行にする。
/// ソースの改行 (と前後の空白) は、両側が日本語の文字なら何も残さず、それ以外 (英文の単語の間・アクセント付きの文字や曲線引用符の前後) は空白 1 つにする。
/// 区切りが続いた時は空行 1 つまでにする
private func normalizedText(_ raw: String) -> String {
    raw
        .replacingOccurrences(
            of: "(?<=\(japaneseCharacterClass))[ \\t]*[\\r\\n][ \\t\\r\\n]*(?=\(japaneseCharacterClass))",
            with: "",
            options: .regularExpression
        )
        .replacingOccurrences(of: #"[ \t]*[\r\n][ \t\r\n]*"#, with: " ", options: .regularExpression)
        .replacingOccurrences(of: "[ \t]+", with: " ", options: .regularExpression)
        .split(separator: blockBreak, omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " ")) }
        .joined(separator: "\n")
        .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}
