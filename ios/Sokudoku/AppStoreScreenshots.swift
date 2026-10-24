#if DEBUG
import SokudokuCore
import SwiftUI

/// App Store のスクリーンショットの 1 枚の画面。背景・キャッチコピー・端末の枠の中に本番のリーダー画面・取り込み画面を出す。
/// ios/scripts/appstore-screenshots.sh が起動引数 (-AppStoreScreenshotPage <番号> -AppStoreScreenshotLanguage <ja|en>) でこの画面を開き、
/// シミュレータの画面を撮る。起動引数で切り替えるのは、撮影をスクリプトだけで回し、ページごとに開発者メニューを操作する手順を挟まないため。
struct AppStoreScreenshotPage: View {
    /// 撮るページの番号 (1 始まり)。App Store に並べる順番と同じ。
    let page: Int
    /// ストアの掲載の言語。キャッチコピーと、端末の枠の中で読む本文の言語を決める。アプリの画面は日本語だけのため、画面の文言は変えない。
    let language: AppStoreScreenshotLanguage

    var body: some View {
        GeometryReader { geometry in
            // 文字の大きさの基準。iPad は横に広く縦の比率が iPhone と違うため、幅だけで決めると見出しが枠に重なる。
            // 高さの 0.46 倍は、iPhone 6.9 インチ (440x956pt) で幅とほぼ同じになる値
            let copyBaseSize = min(geometry.size.width, geometry.size.height * 0.46)
            ZStack(alignment: .top) {
                // 端末の枠の中は、撮影する端末と同じ大きさ・同じ位置で画面を組み立ててから縮めて出す (本番と同じ折り返し・配置にするため)。
                // 0.72 倍は、上の 24% (キャッチコピー) の残りに枠の縁まで収まる倍率
                AppStoreScreenshotDeviceFrame(screenSize: geometry.size, scale: 0.72) {
                    screenContent
                }
                VStack(spacing: 12) {
                    Text(copy.title)
                        .font(.system(size: copyBaseSize * 0.085, weight: .bold))
                        .multilineTextAlignment(.center)
                        .lineSpacing(4)
                    Text(copy.subtitle)
                        .font(.system(size: copyBaseSize * 0.04, weight: .regular))
                        .opacity(0.85)
                        .multilineTextAlignment(.center)
                }
                .foregroundStyle(.white)
                .frame(height: geometry.size.height * 0.21)
                .padding(.top, geometry.size.height * 0.03)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .background(Palette.accent)
        .ignoresSafeArea()
        .statusBarHidden()
        .environment(\.colorScheme, .light)
    }

    @ViewBuilder
    private var screenContent: some View {
        switch page {
        case 1:
            AppStoreScreenshotReader(source: readingSample(language: language), unitText: playingUnitText(language: language), isPlaying: true)
        case 2:
            AppStoreScreenshotReader(source: readingSample(language: language), unitText: pausedUnitText(language: language), isPlaying: false)
        case 3:
            AppStoreScreenshotReader(source: readingSample(language: language.other), unitText: playingUnitText(language: language.other), isPlaying: true)
        default:
            // NavigationStack に入れると、縮めた枠の中で大きい見出しが左端に詰まって本番と違う見た目になる (2026-10-25 に iOS 27 のシミュレータで観測) ため、
            // 見出し (アプリ名) を出さずに取り込み画面の本体だけを出す
            ImportView(open: { _ in })
                .tint(Palette.accent)
        }
    }

    private var copy: (title: String, subtitle: String) {
        switch (page, language) {
        case (1, .ja): ("1 文節ずつ\n同じ位置に", "目を左右に動かさずに読み進める")
        case (1, .en): ("One word at a time\nin one place", "Read on without moving your eyes")
        case (2, .ja): ("止めると\n前後の文と今の位置", "再生中は 1 文節だけを出す")
        case (2, .en): ("Pause to see\nwhere you are", "Only one word shows while playing")
        case (3, .ja): ("英文は\n1 単語ずつ", "速さは語/分で決める")
        case (3, .en): ("Japanese\none phrase at a time", "Set the speed in characters per minute")
        case (_, .ja): ("文章は端末の外へ\n送らない", "区切りも再生もこの端末の中で")
        case (_, .en): ("Your text never\nleaves your device", "Splitting and playback stay on device")
        }
    }
}

/// スクリーンショットのキャッチコピーと、端末の枠の中で読む本文の言語。
enum AppStoreScreenshotLanguage: String {
    case ja
    case en

    /// もう一方の言語。3 枚目で、掲載の言語と違う言語の本文も読めることを見せるのに使う。
    var other: AppStoreScreenshotLanguage {
        switch self {
        case .ja: .en
        case .en: .ja
        }
    }
}

/// 起動引数で指定されたスクリーンショットのページと言語を返す。指定が無ければ nil (通常の起動)。
func appStoreScreenshotLaunchArguments() -> (page: Int, language: AppStoreScreenshotLanguage)? {
    let page = UserDefaults.standard.integer(forKey: "AppStoreScreenshotPage")
    guard page > 0 else {
        return nil
    }
    return (page, AppStoreScreenshotLanguage(rawValue: UserDefaults.standard.string(forKey: "AppStoreScreenshotLanguage") ?? "") ?? .ja)
}

/// 本番のリーダー画面を、指定した単位を出した状態で表示する。区切り終わるまでは区切り中の表示のまま。
private struct AppStoreScreenshotReader: View {
    let source: String
    /// 出しておく単位の文字列。本文の中で最初にこの文字列を含む単位を出す。
    let unitText: String
    let isPlaying: Bool

    @State private var reader: ReaderModel?

    var body: some View {
        NavigationStack {
            if let reader {
                ReaderView(reader: reader, close: {})
            }
        }
        .tint(Palette.accent)
        .task {
            let reader = ReaderModel(source: source)
            while reader.segmented == nil, reader.failureMessage == nil {
                try? await Task.sleep(for: .milliseconds(100))
            }
            let unitIndex = reader.units.firstIndex { $0.text.contains(unitText) } ?? 0
            if isPlaying {
                reader.showPlayingWithoutAdvancing(unitIndex: unitIndex)
            } else {
                reader.step(by: unitIndex - reader.index)
            }
            self.reader = reader
        }
    }
}

/// 端末の枠。中身を画面全体と同じ大きさ・位置で組み立て、scale 倍に縮めて画面の下寄りに出す。
private struct AppStoreScreenshotDeviceFrame<Content: View>: View {
    let screenSize: CGSize
    let scale: CGFloat
    @ViewBuilder let content: Content

    var body: some View {
        // iPad (幅 700pt 以上) はダイナミックアイランドが無く、角の丸みも小さい
        let isPad = screenSize.width >= 700
        let cornerRadius: CGFloat = isPad ? 36 : 56
        let bezel: CGFloat = isPad ? 22 : 16
        // 縮めた枠の下端を画面の高さの 98.5% に置くための、縮小の中心 (縦方向の割合)。
        // 枠の下端は組み立てた位置で screenSize.height + bezel にあり、縮小の中心から scale 倍の距離に寄る
        let anchorY = (screenSize.height * 0.985 - (screenSize.height + bezel) * scale) / (screenSize.height * (1 - scale))
        content
            // 枠の中は上端がステータスバーの位置に当たらないため、ステータスバーの高さぶんの余白を取る。
            // 中身のナビゲーションバーは角の丸みで切り抜かれず、丸みが終わるより上に来ると角に段が出る (2026-10-25 にスクリーンショットで観測) ため、
            // 余白は角の丸みより大きくし、丸みは半径ちょうどで終わる circular にする
            .padding(.top, isPad ? 40 : 62)
            .frame(width: screenSize.width, height: screenSize.height)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .circular))
            .overlay(alignment: .top) {
                if !isPad {
                    Capsule().fill(.black).frame(width: 126, height: 37).padding(.top, 11)
                }
            }
            .padding(bezel)
            .background(Color(white: 0.08), in: RoundedRectangle(cornerRadius: cornerRadius + bezel, style: .circular))
            .frame(width: screenSize.width, height: screenSize.height)
            .scaleEffect(scale, anchor: UnitPoint(x: 0.5, y: anchorY))
    }
}

/// 端末の枠の中で読む本文。日本語は夏目漱石「吾輩は猫である」、英語は Lewis Carroll "Alice's Adventures in Wonderland" の冒頭 (どちらも著作権の保護期間が満了した作品)。
private func readingSample(language: AppStoreScreenshotLanguage) -> String {
    switch language {
    case .ja:
        """
        　吾輩は猫である。名前はまだ無い。
        　どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。この書生というのは時々我々を捕えて煮て食うという話である。しかしその当時は何という考もなかったから別段恐しいとも思わなかった。
        """
    case .en:
        """
        Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "and what is the use of a book," thought Alice "without pictures or conversations?"
        So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.
        """
    }
}

/// 再生中のページで出しておく単位の文字列。
private func playingUnitText(language: AppStoreScreenshotLanguage) -> String {
    switch language {
    case .ja: "人間という"
    case .en: "Rabbit"
    }
}

/// 停止中のページで出しておく単位の文字列。前後の文が画面に収まるよう、本文の中ほどの単位にする。
private func pausedUnitText(language: AppStoreScreenshotLanguage) -> String {
    switch language {
    case .ja: "見当が"
    case .en: "daisy-chain"
    }
}
#endif
