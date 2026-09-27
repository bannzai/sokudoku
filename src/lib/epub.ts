import { unzipSync } from "fflate";
import { Parser } from "htmlparser2";
import type { ImportResult } from "./importText";

// EPUB の OCF ( https://www.w3.org/TR/epub-33/#sec-container-metainf ) で本文の暗号化・権利情報を置くファイル。
// どれかがあれば DRM 付きとして読み込まない (documents/adr/0002-avoid-patented-features-and-drm-import.md)。
// encryption.xml はフォントの難読化だけの EPUB にもあるが、DRM の有無を中身で判定せず一律に読み込まない
const drmMarkerPaths = new Set([
  "META-INF/encryption.xml",
  "META-INF/rights.xml",
  "META-INF/license.lcpl",
  "META-INF/sinf.xml",
]);

const containerPath = "META-INF/container.xml";

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

/** zip の中から、パスが条件に合うファイルだけを展開する。画像などを展開しないよう、読むファイルだけに絞る */
function unzipFiles(bytes: Uint8Array, shouldExtract: (path: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(bytes, { filter: (file) => shouldExtract(file.name) });
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

/** OPF の spine の順に、本文の XHTML の zip の中のパスを並べる。linear="no" の補助的な文書は除く */
function listSpineDocumentPaths(packageDocumentPath: string, packageDocumentXml: string): string[] {
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
  return spineIdrefs.flatMap((idref) => {
    const href = manifestHrefs.get(idref);
    return href === undefined ? [] : [resolveZipPath(packageDirectory, href)];
  });
}

/** XHTML の本文を、ブロック要素の区切りを改行にした文字列にする */
function extractXhtmlText(xhtml: string): string {
  const textParts: string[] = [];
  let skippedDepth = 0;
  // XHTML の実体参照 (&nbsp; など) を読むため HTML として読み、<br/> などの自己終了タグも閉じタグとして扱う
  const parser = new Parser(
    {
      onopentag: (tagName) => {
        if (skippedTagNames.has(localTagName(tagName))) {
          skippedDepth += 1;
        }
      },
      ontext: (text) => {
        if (skippedDepth === 0) {
          textParts.push(text.replace(/\s+/g, " "));
        }
      },
      onclosetag: (tagName) => {
        const name = localTagName(tagName);
        if (skippedTagNames.has(name)) {
          skippedDepth -= 1;
        }
        if (blockTagNames.has(name)) {
          textParts.push("\n");
        }
      },
    },
    { recognizeSelfClosing: true },
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
 * DRM の目印のファイルがある EPUB は本文を返さず drm を返す。zip・EPUB として読めなければ invalid-epub を返す
 */
export function extractEpubText(bytes: Uint8Array): ImportResult {
  const textDecoder = new TextDecoder();
  try {
    const metaInfFiles = unzipFiles(bytes, (path) => path.startsWith("META-INF/"));
    if (Object.keys(metaInfFiles).some((path) => drmMarkerPaths.has(path))) {
      return { ok: false, reason: "drm" };
    }
    const containerXml = metaInfFiles[containerPath];
    const packageDocumentPath = containerXml && findPackageDocumentPath(textDecoder.decode(containerXml));
    if (!packageDocumentPath) {
      return { ok: false, reason: "invalid-epub" };
    }
    const packageDocument = unzipFiles(bytes, (path) => path === packageDocumentPath)[packageDocumentPath];
    if (packageDocument === undefined) {
      return { ok: false, reason: "invalid-epub" };
    }
    const spineDocumentPaths = listSpineDocumentPaths(packageDocumentPath, textDecoder.decode(packageDocument));
    const spineDocuments = unzipFiles(bytes, (path) => spineDocumentPaths.includes(path));
    return {
      ok: true,
      text: spineDocumentPaths
        .flatMap((path) => (spineDocuments[path] === undefined ? [] : [extractXhtmlText(textDecoder.decode(spineDocuments[path]))]))
        .filter((documentText) => documentText !== "")
        .join("\n"),
    };
  } catch {
    // fflate は zip として壊れたバイト列で例外を投げる
    return { ok: false, reason: "invalid-epub" };
  }
}
