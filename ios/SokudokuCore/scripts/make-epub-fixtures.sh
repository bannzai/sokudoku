#!/bin/bash
# SokudokuCore のテスト (EpubTests) が読む小さな EPUB を Tests/SokudokuCoreTests/Fixtures/ に作り直す。
# 中身を変えた時は、このスクリプトを実行してできた .epub もコミットする。何度実行しても同じ中身の EPUB になる
#   sample.epub          DRM の無い本。spine の順・ルビ・見出し・段落・表紙や目次の除外を確かめる
#   drm.epub             sample.epub に、本文の文書 (2 章目) を暗号化した encryption.xml を足したもの
#   font-obfuscated.epub sample.epub に、フォントの難読化だけの encryption.xml を足したもの
set -euo pipefail

fixtures_dir="$(cd "$(dirname "$0")/../Tests/SokudokuCoreTests/Fixtures" && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

write_sample() {
  local root="$1"
  mkdir -p "$root/META-INF" "$root/OEBPS/text"
  printf 'application/epub+zip' >"$root/mimetype"
  cat >"$root/META-INF/container.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
XML
  # manifest の並びと spine の並びを変え、spine の順で読むことを確かめる
  cat >"$root/OEBPS/content.opf" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>
    <dc:title>テスト用の本</dc:title>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="chapter2" href="text/chapter%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter3" href="text/chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="nav"/>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
    <itemref idref="chapter3"/>
    <itemref idref="notes" linear="no"/>
  </spine>
</package>
XML
  cat >"$root/OEBPS/cover.xhtml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>表紙</title></head>
<body><div><img src="cover.png" alt=""/></div></body></html>
XML
  cat >"$root/OEBPS/nav.xhtml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目次</title></head>
<body><nav epub:type="toc"><ol><li><a href="text/chapter1.xhtml">第一章</a></li></ol></nav></body></html>
XML
  cat >"$root/OEBPS/notes.xhtml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>注</title></head>
<body><p>本文の流れの外の注</p></body></html>
XML
  # 青空文庫の EPUB と同じ XHTML 1.1 の DOCTYPE と &nbsp; を使い、外部 DTD を読まずに解析できることを確かめる
  cat >"$root/OEBPS/text/chapter1.xhtml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>ファイルの題名</title>
  <style type="text/css">p { color: red; }</style>
</head>
<body>
  <h1>第一章　猫</h1>
  <p><ruby>吾輩<rp>（</rp><rt>わがはい</rt><rp>）</rp></ruby>は猫である。名前は
    まだ無い。</p>
  <script type="text/javascript">alert("スクリプト");</script>
  <p><img src="cat.png" alt="猫の絵"/>どこで生れたか&nbsp;とんと見当がつかぬ。</p>
</body>
</html>
XML
  cat >"$root/OEBPS/text/chapter 2.xhtml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>2</title></head>
<body>
  <p>This is
    an English line.</p>
  <p>一行目<br/>二行目</p>
  <p><![CDATA[CDATA の中の文]]></p>
</body>
</html>
XML
  # UTF-16 (BOM 付き) で保存した文書も、XML 宣言の文字コードで読めることを確かめる
  iconv -f UTF-8 -t UTF-16 >"$root/OEBPS/text/chapter3.xhtml" <<'XML'
<?xml version="1.0" encoding="UTF-16"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>3</title></head>
<body><h2>第三章</h2><p>UTF-16 で書いた本文</p></body>
</html>
XML
}

write_encryption() {
  local root="$1" uri="$2" algorithm="$3"
  cat >"$root/META-INF/encryption.xml" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="$algorithm"/>
    <enc:CipherData><enc:CipherReference URI="$uri"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>
XML
}

# mimetype を無圧縮で先頭に置き (OCF の要件)、残りは deflate で圧縮する。日時を固定して同じ中身なら同じバイト列にする
pack() {
  local root="$1" output="$2"
  find "$root" -exec touch -t 202601010000 {} +
  rm -f "$output"
  (cd "$root" && zip -X0q "$output" mimetype && zip -Xr9Dq "$output" . -x mimetype)
}

write_sample "$work_dir/sample"
pack "$work_dir/sample" "$fixtures_dir/sample.epub"

write_sample "$work_dir/drm"
# URI は percent-encode された形で書かれるため、空白を含むパスの章を暗号化した形にし、manifest の href と同じパスに揃えて比べることを確かめる
write_encryption "$work_dir/drm" "OEBPS/text/chapter%202.xhtml" "http://www.w3.org/2001/04/xmlenc#aes128-cbc"
pack "$work_dir/drm" "$fixtures_dir/drm.epub"

write_sample "$work_dir/font-obfuscated"
write_encryption "$work_dir/font-obfuscated" "OEBPS/fonts/font.otf" "http://www.idpf.org/2008/embedding"
pack "$work_dir/font-obfuscated" "$fixtures_dir/font-obfuscated.epub"
