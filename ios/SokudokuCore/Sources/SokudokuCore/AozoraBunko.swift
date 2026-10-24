import Foundation

// 青空文庫のテキストファイルの注記を除き、読む本文だけにする。Web 版の src/lib/aozoraBunko.ts と同じ規則。
// 記法は青空文庫の「注記一覧」( https://www.aozora.gr.jp/annotation/ ) に従う

/// 冒頭の【テキスト中に現れる記号について】の区切り
private let symbolDescriptionHeading = "【テキスト中に現れる記号について】"
/// 底本情報の書き出し
private let sourceBookLinePrefix = "底本："
/// 青空文庫のファイルの末尾に必ず入る「このファイルは、インターネットの図書館、青空文庫 (URL) で作られました」の一部。
/// 行頭の「底本：」だけでは書評などの引用と見分けられず、それ以降の本文を消してしまうため、この文と揃った時だけ底本情報とみなす
private let aozoraBunkoCreditPhrase = "インターネットの図書館、青空文庫"

/// 貼り付けた文字列や txt の中身を、読む本文にして返す。改行を LF に揃え、青空文庫の書式なら注記を除く (Web 版の importPlainText と同じ)。
public func readableText(importedText: String) -> String {
    let normalized = importedText.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    return isAozoraBunkoText(normalized) ? stripAozoraBunkoNotation(normalized) : normalized
}

/// 青空文庫の書式 (注記・記号の説明・青空文庫の作成の文を伴う底本情報) を含むテキストかを返す。
public func isAozoraBunkoText(_ text: String) -> Bool {
    text.contains(symbolDescriptionHeading)
        || text.contains("［＃")
        || findSourceBookFooterStart(lines: text.components(separatedBy: "\n"), searchStart: 0) != nil
}

/// 青空文庫のテキストから、冒頭の記号の説明・末尾の底本情報・ルビ (《》と｜)・入力者注 (［＃...］) を除いた本文を返す。
/// 題名と著者名の行は本文の前に残す。外字の注記は注記だけを除き、外字の位置を示す ※ は残す。改行は LF に揃えたテキストを受け取る
public func stripAozoraBunkoNotation(_ text: String) -> String {
    let lines = text.components(separatedBy: "\n")
    let headerStart = lines.firstIndex(where: isSeparatorLine)
    let headerEnd = headerStart.flatMap { start in lines.indices.first { $0 > start && isSeparatorLine(lines[$0]) } }
    let symbolDescriptionRange: ClosedRange<Int>? = headerStart.flatMap { start in
        headerEnd.flatMap { end in lines[start..<end].contains { $0.contains(symbolDescriptionHeading) } ? start...end : nil }
    }
    let footerStart = findSourceBookFooterStart(lines: lines, searchStart: symbolDescriptionRange.map { $0.upperBound + 1 } ?? 0)
    let bodyLines = lines[..<(footerStart ?? lines.count)].enumerated()
        .filter { index, _ in !(symbolDescriptionRange?.contains(index) ?? false) }
        .map { $0.element }
    return removeInputterNotes(bodyLines.joined(separator: "\n"))
        .replacingOccurrences(of: "《[^》]*》", with: "", options: .regularExpression)
        .replacingOccurrences(of: "｜", with: "")
        .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

/// 青空文庫の底本情報の先頭の行の位置を返し、青空文庫の底本情報が無ければ nil を返す。
/// 上下巻などで底本が複数列記されるため、最初の底本の行から末尾までを底本情報とする
private func findSourceBookFooterStart(lines: [String], searchStart: Int) -> Int? {
    guard let footerStart = lines.indices.first(where: { $0 >= searchStart && lines[$0].hasPrefix(sourceBookLinePrefix) }),
          lines[(footerStart + 1)...].contains(where: { $0.contains(aozoraBunkoCreditPhrase) })
    else {
        return nil
    }
    return footerStart
}

/// 青空文庫の冒頭と記号の説明を挟む、ハイフンだけの区切り行かを返す。
private func isSeparatorLine(_ line: String) -> Bool {
    line.trimmingCharacters(in: .whitespaces).range(of: "^-{10,}$", options: .regularExpression) != nil
}

/// 入力者注 (［＃...］) を除いた文字列を返す。外字を含む語への注記 (［＃「※［＃外字の説明］」に傍点］) のように
/// 注記の中に［］が入れ子になるため、括弧の深さを数えて外側の］までを除く
private func removeInputterNotes(_ text: String) -> String {
    let characters = Array(text)
    var noteDepth = 0
    var result = ""
    for (index, character) in characters.enumerated() {
        let opensNote = character == "［" && index + 1 < characters.count && characters[index + 1] == "＃"
        if opensNote || (noteDepth > 0 && character == "［") {
            noteDepth += 1
        } else if noteDepth > 0 {
            if character == "］" {
                noteDepth -= 1
            }
        } else {
            result.append(character)
        }
    }
    return result
}
