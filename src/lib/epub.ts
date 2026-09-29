import { unzipSync } from "fflate";
import { Parser } from "htmlparser2";
import type { ImportResult } from "./importText";

// EPUB の OCF ( https://www.w3.org/TR/epub-33/#sec-container-metainf ) で本文の暗号化・権利情報を置くファイル。
// どれかがあれば DRM 付きとして読み込まない (documents/adr/0002-avoid-patented-features-and-drm-import.md)。
// encryption.xml はフォントの難読化だけの EPUB にもあるが、DRM の有無を中身で判定せず一律に読み込まない。
// 仕様どおりでない大文字小文字の EPUB も見逃さないよう、小文字にしたパスで照合する
const lowerCaseDrmMarkerPaths = new Set([
  "meta-inf/encryption.xml",
  "meta-inf/rights.xml",
  "meta-inf/license.lcpl",
  "meta-inf/sinf.xml",
]);

const containerPath = "META-INF/container.xml";

// 展開するファイル (container.xml・OPF・spine の XHTML) の展開後の大きさの合計の上限。
// 長編小説 1 冊でも本文は 50 万字程度で UTF-8 では 1.5 MB、XHTML のマークアップを含めても 10 MB に届かないため、
// 数倍の余裕を持たせつつ、展開後の大きさを偽った zip (zip bomb) でブラウザのタブのメモリを使い切らない大きさにする
const maxExtractedBytes = 64 * 1024 * 1024;

// 本文に含めない要素。ルビの読み (rt・rp) は本文の文字の後ろに読みが続いてしまうため除く
const skippedTagNames = new Set(["head", "script", "style", "rt", "rp"]);

// 閉じた位置で改行を入れる要素
const blockTagNames = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "br",
  "dd",
  "div",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

/** `opf:item` のような名前空間の接頭辞を除いた要素名を返す */
function localTagName(tagName: string): string {
  return tagName.slice(tagName.lastIndexOf(":") + 1).toLowerCase();
}

/** zip の中のファイルのパスと展開後の大きさ (central directory の宣言値) を、展開せずに並べる */
function listZipEntrySizes(bytes: Uint8Array): Map<string, number> {
  const entrySizes = new Map<string, number>();
  unzipSync(bytes, {
    filter: (file) => {
      entrySizes.set(file.name, file.originalSize);
      return false;
    },
  });
  return entrySizes;
}

/**
 * 読むファイルの展開後の大きさの合計が上限を超えるかを、展開する前に宣言値で判定する。
 * fflate は宣言値の大きさの領域に展開し、それを超えて広げないため、宣言値で判定すれば実際の展開量も上限に収まる
 */
function exceedsExtractionLimit(entrySizes: Map<string, number>, paths: string[]): boolean {
  return [...new Set(paths)].reduce((totalBytes, path) => totalBytes + (entrySizes.get(path) ?? 0), 0) > maxExtractedBytes;
}

/** zip の中から、指定したパスのファイルだけを展開する。画像などを展開しないよう、読むファイルだけに絞る */
function unzipFiles(bytes: Uint8Array, paths: string[]): Record<string, Uint8Array> {
  return unzipSync(bytes, { filter: (file) => paths.includes(file.name) });
}

/** XML を読み、要素ごとに名前 (接頭辞を除く) と属性を onElement に渡す */
function forEachXmlElement(xml: string, onElement: (tagName: string, attributes: Record<string, string>) => void) {
  const parser = new Parser(
    { onopentag: (tagName, attributes) => onElement(localTagName(tagName), attributes) },
    { xmlMode: true },
  );
  parser.write(xml);
  parser.end();
}

/** OPF のあるディレクトリを基準に、manifest の href を zip の中のパスにする */
function resolveZipPath(baseDirectory: string, href: string): string {
  const hrefPath = href.replace(/[?#].*$/, "");
  let decodedHrefPath = hrefPath;
  try {
    decodedHrefPath = decodeURIComponent(hrefPath);
  } catch {
    // % の後ろが 16 進数でない href は、エンコードされていないパスとしてそのまま使う
  }
  return `${baseDirectory}${decodedHrefPath}`
    .split("/")
    .reduce<string[]>((segments, segment) => {
      if (segment === "..") {
        return segments.slice(0, -1);
      }
      return segment === "" || segment === "." ? segments : [...segments, segment];
    }, [])
    .join("/");
}

/** container.xml から OPF (パッケージ文書) のパスを取り出す */
function findPackageDocumentPath(containerXml: string): string | undefined {
  let packageDocumentPath: string | undefined;
  forEachXmlElement(containerXml, (tagName, attributes) => {
    if (tagName === "rootfile" && packageDocumentPath === undefined) {
      packageDocumentPath = attributes["full-path"];
    }
  });
  return packageDocumentPath;
}

/**
 * OPF の spine の順に、本文の XHTML の zip の中のパスを並べる。linear="no" の補助的な文書は除く。
 * manifest に無い idref があれば、章が欠けた EPUB として undefined を返す
 */
function listSpineDocumentPaths(packageDocumentPath: string, packageDocumentXml: string): string[] | undefined {
  const manifestHrefs = new Map<string, string>();
  const spineIdrefs: string[] = [];
  forEachXmlElement(packageDocumentXml, (tagName, attributes) => {
    if (tagName === "item" && attributes.id !== undefined && attributes.href !== undefined) {
      manifestHrefs.set(attributes.id, attributes.href);
    }
    if (tagName === "itemref" && attributes.idref !== undefined && attributes.linear !== "no") {
      spineIdrefs.push(attributes.idref);
    }
  });
  const packageDirectory = packageDocumentPath.slice(0, packageDocumentPath.lastIndexOf("/") + 1);
  const spineHrefs = spineIdrefs.map((idref) => manifestHrefs.get(idref));
  return spineHrefs.every((href): href is string => href !== undefined)
    ? spineHrefs.map((href) => resolveZipPath(packageDirectory, href))
    : undefined;
}

/**
 * EPUB の中の XML・XHTML のバイト列を文字列にする。EPUB は UTF-8 か UTF-16 を許し
 * ( https://www.w3.org/TR/epub-33/#sec-xml-constraints )、XML は UTF-16 の時に BOM を必須とするため、BOM で UTF-16 を見分ける
 */
function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** XHTML の本文を、ブロック要素の開始と終了を改行にした文字列にする */
function extractXhtmlText(xhtml: string): string {
  const textParts: string[] = [];
  let skippedDepth = 0;
  // pre の中は改行が詩の行などの区切りのため、空白を詰めず改行を残す
  let preformattedDepth = 0;
  // XHTML の実体参照 (&nbsp; など) を読むため HTML として読み、<br/> などの自己終了タグも閉じタグとして扱う。
  // HTML として読むと CDATA がコメント扱いになり本文が欠けるため、CDATA をテキストとして読む
  const parser = new Parser(
    {
      onopentag: (tagName) => {
        const name = localTagName(tagName);
        if (skippedTagNames.has(name)) {
          skippedDepth += 1;
        }
        if (name === "pre") {
          preformattedDepth += 1;
        }
        // <div>前<p>後</p></div> の「前」と「後」を連結しないよう、ブロックの開始でも区切る
        if (blockTagNames.has(name)) {
          textParts.push("\n");
        }
      },
      ontext: (text) => {
        if (skippedDepth === 0) {
          textParts.push(preformattedDepth > 0 ? text : text.replace(/\s+/g, " "));
        }
      },
      onclosetag: (tagName) => {
        const name = localTagName(tagName);
        if (skippedTagNames.has(name)) {
          skippedDepth -= 1;
        }
        if (name === "pre") {
          preformattedDepth -= 1;
        }
        if (blockTagNames.has(name)) {
          textParts.push("\n");
        }
      },
    },
    { recognizeSelfClosing: true, recognizeCDATA: true },
  );
  parser.write(xhtml);
  parser.end();
  return textParts
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * EPUB のバイト列から、spine の順に本文の文字列を取り出す。
 * DRM の目印のファイルがある EPUB は本文を返さず drm を返す。読むファイルの展開後の大きさが上限を超えれば too-large を返す。
 * zip・EPUB として読めない、または spine の章が欠けていれば invalid-epub を返す
 */
export function extractEpubText(bytes: Uint8Array): ImportResult {
  try {
    const entrySizes = listZipEntrySizes(bytes);
    if ([...entrySizes.keys()].some((path) => lowerCaseDrmMarkerPaths.has(path.toLowerCase()))) {
      return { ok: false, reason: "drm" };
    }
    if (exceedsExtractionLimit(entrySizes, [containerPath])) {
      return { ok: false, reason: "too-large" };
    }
    const containerXml = unzipFiles(bytes, [containerPath])[containerPath];
    const packageDocumentPath = containerXml && findPackageDocumentPath(decodeXmlBytes(containerXml));
    if (!packageDocumentPath) {
      return { ok: false, reason: "invalid-epub" };
    }
    if (exceedsExtractionLimit(entrySizes, [containerPath, packageDocumentPath])) {
      return { ok: false, reason: "too-large" };
    }
    const packageDocument = unzipFiles(bytes, [packageDocumentPath])[packageDocumentPath];
    if (packageDocument === undefined) {
      return { ok: false, reason: "invalid-epub" };
    }
    const spineDocumentPaths = listSpineDocumentPaths(packageDocumentPath, decodeXmlBytes(packageDocument));
    if (spineDocumentPaths === undefined) {
      return { ok: false, reason: "invalid-epub" };
    }
    if (exceedsExtractionLimit(entrySizes, [containerPath, packageDocumentPath, ...spineDocumentPaths])) {
      return { ok: false, reason: "too-large" };
    }
    const spineDocuments = unzipFiles(bytes, spineDocumentPaths);
    // 章が欠けたまま成功にすると、利用者は不完全な本文を全文だと思って読むため失敗にする
    if (spineDocumentPaths.some((path) => spineDocuments[path] === undefined)) {
      return { ok: false, reason: "invalid-epub" };
    }
    return {
      ok: true,
      text: spineDocumentPaths
        .map((path) => extractXhtmlText(decodeXmlBytes(spineDocuments[path])))
        .filter((documentText) => documentText !== "")
        .join("\n"),
    };
  } catch {
    // fflate は zip として壊れたバイト列で例外を投げる
    return { ok: false, reason: "invalid-epub" };
  }
}
