<div align="center">

# Claude Remote Plugins

**Preview plugins for [Claude Remote](https://github.com/TomEageer/claude-remote)**

The plugin store that Claude Remote reads: PDF, Word, Excel, PowerPoint and code previews.<br>
Each plugin version has a per-file sha256 manifest, so updates download only the files that changed.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/plugin%20network%20access-none-success)](docs/plugins.md)

[Plugins](#plugins) · [How updates work](#how-updates-work) · [Write a plugin](docs/plugins.md) · [**中文**](#中文)

</div>

---

## Plugins

| Plugin | Opens | Built on |
|---|---|---|
| `pdf-viewer` | pdf | [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) |
| `word-viewer` | docx | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) (Apache-2.0), JSZip (MIT) |
| `excel-viewer` | xlsx, xls, xlsm, ods, csv | [SheetJS](https://sheetjs.com) 0.20.3 (Apache-2.0) |
| `ppt-viewer` | pptx | [pptx-preview](https://www.npmjs.com/package/pptx-preview) (npm package, ISC) |
| `code-viewer` | 40+ code and text formats, Markdown | [highlight.js](https://highlightjs.org) (BSD-3), marked (MIT), DOMPurify |

Install them from the **Preview plugins** page inside Claude Remote. Plugins run in their own `crplugin://` origin; the app's content-security policy blocks all network access, so a plugin can only read the one file you open.

## How updates work

```
index.json                       store list (main branch)
releases/<id>/<version>.json     per-file manifest: path, size, sha256
plugins/<id>/…                   plugin files, read at tag <id>-v<version>
```

The app compares each file's sha256 with what it already has and downloads only the changed ones, trying `raw.githubusercontent.com` first and then jsDelivr mirrors (`cdn`, `fastly`, `gcore`). Every downloaded file is size- and sha256-checked; a local file that was modified gets downloaded again.

`pptx-preview`'s author allows free personal and commercial use of the npm package but not republishing its source, so it is **not stored in this repository**: its manifest entry points at the unmodified file on npm CDNs, pinned by sha256.

## Releasing

```bash
npm install
node scripts/build.js      # vendor libraries, write releases/*.json and index.json
git add -A && git commit -m "release: …"
git tag <id>-v<version>    # for every new version the script lists
git push origin main --tags
curl -s https://purge.jsdelivr.net/gh/TomEageer/claude-remote-plugins@main/index.json   # refresh the jsDelivr mirror
```

Plugin development guide (manifest, message protocol, CSP, test harness): [docs/plugins.md](docs/plugins.md).

---

## 中文

[Claude 远程助手](https://github.com/TomEageer/claude-remote) 的预览插件仓库，软件里的「预览插件」页就是从这里读取的。

- **插件**：PDF、Word（docx）、Excel / CSV、PPT（pptx）、代码与 Markdown，所用开源库见上表
- **安全**：插件运行在独立的 `crplugin://` 源里，内容安全策略禁止联网，只能看到你打开的那一个文件
- **增量更新**：每个版本都有逐文件的 sha256 清单，更新时只下载变了的文件；先试 GitHub 原站，失败自动换 jsDelivr 镜像（国内可用），每个文件都校验
- **pptx-preview**：作者允许免费使用其 npm 包（自用商用均可），但不允许再发布源码，所以本仓库不存放它，清单里指向 npm CDN 上的原版文件并固定 sha256
- **发布新版本**：`node scripts/build.js` 后按提示提交、打 tag、推送
- **写插件**：见 [docs/plugins.md](docs/plugins.md)（中英双语）

## License

MIT for the plugin code in this repository. Third-party libraries keep their own licenses (see each plugin's `vendor/LICENSE-*`).
