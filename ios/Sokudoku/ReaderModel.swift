import Foundation
import Observation
import SokudokuCore

/// 1 つの本文を読む間のリーダーの状態 (区切った単位・現在の位置・再生中か・速度)。SwiftUI の画面が変更を観測するため class にする。
@MainActor
@Observable
final class ReaderModel {
    /// 読んでいる本文。端末の外へ送らず、保存もしない。
    let source: String
    /// 本文を区切った結果。区切り終わるまでは nil。
    private(set) var segmented: SegmentedText?
    /// 区切りに失敗した時の理由 (MeCab の辞書を開けない等)。
    private(set) var failureMessage: String?
    /// 表示中の単位の位置。
    private(set) var index = 0
    /// 再生中か。停止中だけ全文と現在位置を出す (documents/adr/0002-avoid-patented-features-and-drm-import.md)。
    private(set) var isPlaying = false
    /// 最後の単位を表示時間いっぱいまで出し終えたか。最後の単位に移動しただけ・その途中で止めただけでは立てない。読み終えた後の再生だけを先頭からの読み直しにするために使う。
    private(set) var isFinished = false
    /// 読む速度。端末に保存し、次に開いた時も同じ速度で読む。
    private(set) var speed: ReadingSpeed

    private var playback: Task<Void, Never>?

    init(source: String) {
        self.source = source
        self.speed = loadSpeed()
        Task { await segment() }
    }

    var units: [ReadingUnit] { segmented?.units ?? [] }

    var currentUnit: ReadingUnit? { units.indices.contains(index) ? units[index] : nil }

    /// 本文に含まれる言語。速度の上げ下げを、本文にある言語の速度だけに出すのに使う。
    var languages: [Language] {
        [Language.ja, .en].filter { language in units.contains { $0.language == language } }
    }

    /// 各位置から最後までの残り時間。分割の完了時と速度の変更時に計算し直す。
    private var remainingDurationsByIndex: [TimeInterval] = [0]

    var remainingSeconds: TimeInterval {
        remainingDurationsByIndex.indices.contains(index) ? remainingDurationsByIndex[index] : 0
    }

    var isAtEnd: Bool { !units.isEmpty && index == units.count - 1 }

    func togglePlayback() {
        isPlaying ? pause() : play()
    }

    func play() {
        guard !units.isEmpty else {
            return
        }
        if isFinished {
            move(to: 0)
        }
        isPlaying = true
        playback = Task { [weak self] in
            await self?.runPlayback()
        }
    }

    func pause() {
        isPlaying = false
        playback?.cancel()
        playback = nil
    }

    /// 単位を前後に移動する (負の数で戻る)。再生中なら一時停止する。
    func step(by delta: Int) {
        pause()
        move(to: index + delta)
    }

    func changeSpeed(language: Language, by stepDelta: Int) {
        speed = speed.stepped(language: language, by: stepDelta)
        remainingDurationsByIndex = remainingDurations(units: units, speed: speed)
        saveSpeed(speed)
    }

    private func segment() async {
        let source = source
        do {
            // MeCab の辞書を開いて区切る処理は本文の長さに比例して時間がかかるため、画面を止めないように別のスレッドで行う
            let result = try await Task.detached(priority: .userInitiated) {
                try TextSegmenter().segment(source)
            }.value
            segmented = result
            remainingDurationsByIndex = remainingDurations(units: result.units, speed: speed)
            index = resumableIndex(savedIndex: loadPosition(key: textKey(source)), unitCount: result.units.count)
        } catch {
            failureMessage = "本文を区切れませんでした: \(error.localizedDescription)"
        }
    }

    private func runPlayback() async {
        while isPlaying, let unit = currentUnit {
            try? await Task.sleep(for: .seconds(displayDuration(unit: unit, speed: speed)))
            guard isPlaying, !Task.isCancelled else {
                return
            }
            guard !isAtEnd else {
                // 読み終えても読了画面へ切り替えず、最後の単位を出したまま止める (Web 版の PR #39 と同じ)
                pause()
                isFinished = true
                return
            }
            move(to: index + 1)
        }
    }

    private func move(to newIndex: Int) {
        guard !units.isEmpty else {
            return
        }
        index = min(max(newIndex, 0), units.count - 1)
        isFinished = false
        savePosition(key: textKey(source), index: index)
    }
}

private let speedDefaultsKey = "readingSpeed"
private let positionsDefaultsKey = "readingPositions"

/// 端末に保存した速度を読む。保存が無い・読めない時は既定の速度にする。
private func loadSpeed() -> ReadingSpeed {
    guard let data = UserDefaults.standard.data(forKey: speedDefaultsKey),
          let speed = try? JSONDecoder().decode(ReadingSpeed.self, from: data)
    else {
        return .default
    }
    return speed
}

private func saveSpeed(_ speed: ReadingSpeed) {
    UserDefaults.standard.set(try? JSONEncoder().encode(speed), forKey: speedDefaultsKey)
}

/// 本文のキーごとに保存した読書位置を読む。
private func loadPosition(key: String) -> Int? {
    (UserDefaults.standard.dictionary(forKey: positionsDefaultsKey) as? [String: Int])?[key]
}

private func savePosition(key: String, index: Int) {
    var positions = (UserDefaults.standard.dictionary(forKey: positionsDefaultsKey) as? [String: Int]) ?? [:]
    positions[key] = index
    UserDefaults.standard.set(positions, forKey: positionsDefaultsKey)
}
