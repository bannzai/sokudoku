import XCTest
@testable import SokudokuCore

final class ReadingProgressTests: XCTestCase {
    func testTextKeyIsStableSHA256() {
        XCTAssertEqual(textKey("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertNotEqual(textKey("吾輩は猫である。"), textKey("吾輩は猫である"))
    }

    func testRemainingDurationsAreSuffixSums() {
        let units = [
            ReadingUnit(text: "吾輩は", start: 0, end: 3, language: .ja, sentenceIndex: 0, pause: .none),
            ReadingUnit(text: "猫である。", start: 3, end: 8, language: .ja, sentenceIndex: 0, pause: .sentence),
        ]
        let durations = remainingDurations(units: units, speed: .default)
        XCTAssertEqual(durations.count, 3)
        XCTAssertEqual(durations[0], 1.3, accuracy: 0.0001)
        XCTAssertEqual(durations[1], 1.0, accuracy: 0.0001)
        XCTAssertEqual(durations[2], 0)
        XCTAssertEqual(remainingDurations(units: [], speed: .default), [0])
    }

    func testResumableIndexIsClamped() {
        XCTAssertEqual(resumableIndex(savedIndex: nil, unitCount: 10), 0)
        XCTAssertEqual(resumableIndex(savedIndex: 4, unitCount: 10), 4)
        XCTAssertEqual(resumableIndex(savedIndex: 40, unitCount: 10), 9)
        XCTAssertEqual(resumableIndex(savedIndex: 3, unitCount: 0), 0)
    }
}
