#!/bin/bash
# App Store のスクリーンショットを撮り、fastlane の形 (ios/fastlane/screenshots/<言語>/) に置く。
#
# 使い方: リポジトリのルートで bash ios/scripts/appstore-screenshots.sh (make screenshots-ios)
#
# Debug ビルドのアプリを、起動引数 -AppStoreScreenshotPage <番号> -AppStoreScreenshotLanguage <ja|en> で
# スクリーンショット用の画面 (ios/Sokudoku/AppStoreScreenshots.swift) として起動し、シミュレータの画面を撮る。
# 端末は App Store Connect が求める大きさのうち、iPhone は 6.9 インチ (1320x2868)、iPad は 13 インチ (2064x2752) の 1 機種ずつ。
# シミュレータは sim-boot (castle の ~/bin) でプロジェクト固有の台を起動する。
#
# 出力: ios/fastlane/screenshots/{ja,en-US}/<ページ番号>_<機種>.png (alpha なし)。既存のファイルは上書きする (冪等)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

app=ios/build/Build/Products/Debug-iphonesimulator/Sokudoku.app
bundle_id=com.bannzai.sokudoku
pages=(1 2 3 4)
# 端末の機種と、ファイル名に使う短い名前
devices=("iPhone 17 Pro Max:iphone-6.9" "iPad Pro 13-inch (M5):ipad-13")

make build-ios

for entry in "${devices[@]}"; do
  device_type=${entry%%:*}
  device_label=${entry##*:}
  # 機種ごとに別の台にする (sim-boot は同名の台を機種を見ずに再利用するため)
  number=1
  [[ $device_label == ipad-* ]] && number=2
  udid=$(SCRIPT_QUIET=1 SIM_DEVICE_TYPE="$device_type" sim-boot --number "$number" | sed -n 's/^DEVICE_UDID=//p')
  actual_type=$(xcrun simctl list devices -j | jq -r --arg u "$udid" '.devices[][] | select(.udid == $u) | .deviceTypeIdentifier')
  expected_type=$(xcrun simctl list devicetypes -j | jq -r --arg n "$device_type" '.devicetypes[] | select(.name == $n) | .identifier')
  if [[ $actual_type != "$expected_type" ]]; then
    echo "ERROR: sim-boot が再利用した $udid の機種 ($actual_type) が $device_type ($expected_type) と違う。xcrun simctl delete $udid の後にやり直す" >&2
    exit 1
  fi
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl install "$udid" "$app"
  xcrun simctl ui "$udid" appearance light
  for language in ja en; do
    fastlane_language=$language
    [[ $language == en ]] && fastlane_language=en-US
    mkdir -p "ios/fastlane/screenshots/$fastlane_language"
    for page in "${pages[@]}"; do
      xcrun simctl terminate "$udid" "$bundle_id" >/dev/null 2>&1 || true
      xcrun simctl launch "$udid" "$bundle_id" -AppStoreScreenshotPage "$page" -AppStoreScreenshotLanguage "$language" >/dev/null
      # 起動と MeCab の辞書を開いて本文を区切るのを待つ
      sleep 5
      out="ios/fastlane/screenshots/$fastlane_language/${page}_${device_label}.png"
      xcrun simctl io "$udid" screenshot --type=png "$out" >/dev/null
      swift ios/scripts/flatten-png.swift "$out"
      sips -g pixelWidth -g pixelHeight -g hasAlpha "$out" | tail -n 3 | tr -s ' \n' ' '
      echo "$out"
    done
  done
  xcrun simctl terminate "$udid" "$bundle_id" >/dev/null 2>&1 || true
done
