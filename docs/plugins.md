# 文件预览插件开发指南 / Preview Plugin Developer Guide

[中文](#中文) | [English](#english)

---

## 中文

Claude Remote 用「预览插件」在客户端里预览远程服务器上的文件。每个插件是一个静态网页（HTML + JS + CSS），运行在与主界面隔离的 iframe 中：主软件把文件内容通过 `postMessage` 交给插件，插件负责渲染。

内置的 5 个插件（`plugins/` 目录）可以直接当作示例参考：

| id | 名称 | 扩展名 | 渲染库 |
|---|---|---|---|
| pdf-viewer | PDF 预览 | pdf | pdf.js |
| word-viewer | Word 预览 | docx | docx-preview |
| excel-viewer | 表格预览 | xlsx, xls, xlsm, ods, csv | SheetJS |
| ppt-viewer | 幻灯片预览 | pptx | pptx-preview |
| code-viewer | 代码与文本预览 | js, py, json, md 等 | highlight.js、marked、DOMPurify |

### 1. 目录结构

```
plugins/<id>/
├── manifest.json      必需，插件描述
├── index.html         入口页面（manifest.entry 指定）
├── app.js             插件脚本（文件名自定）
├── style.css
└── vendor/            第三方库及其许可证文件
```

- 所有文件都必须放在插件目录内。**不能引用 CDN，不能发起任何网络请求**（CSP 会直接拦截）。
- 目录名必须与 `manifest.id` 一致。

### 2. manifest.json

```json
{
  "id": "pdf-viewer",
  "name": "PDF 预览",
  "version": "1.0.0",
  "description": "逐页渲染 PDF 文档，支持缩放与页码跳转。",
  "author": "Claude Remote",
  "license": "MIT AND Apache-2.0",
  "extensions": ["pdf"],
  "entry": "index.html",
  "minAppVersion": "1.3.0"
}
```

| 字段 | 说明 |
|---|---|
| `id` | 插件唯一标识，正则 `^[a-z0-9][a-z0-9-]{0,63}$`，即 `crplugin://<id>/` 的主机名 |
| `name` | 显示名称 |
| `version` | 语义化版本 `x.y.z`，升级时必须递增 |
| `description` | 一句话说明 |
| `author` | 作者 |
| `license` | SPDX 许可证表达式，要覆盖插件自身代码和打包进去的所有第三方库 |
| `extensions` | 能预览的扩展名数组：小写、不带点 |
| `entry` | 入口 HTML，相对插件目录 |
| `minAppVersion` | 需要的最低主软件版本 |

多个插件声明同一扩展名时，由主软件决定优先级（例如 csv 优先交给 excel-viewer）。

### 3. 加载方式与安全限制

主软件这样加载插件：

```html
<iframe src="crplugin://<id>/index.html"></iframe>
```

`crplugin://<id>/<路径>` 映射到插件目录下的文件。每个插件是独立的源（origin），与主界面跨源，**访问不到主界面的 DOM，也访问不到 Node.js**。

每个响应都带有如下 CSP：

```
default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval' blob:;
style-src 'self' 'unsafe-inline' blob: data:; img-src 'self' blob: data:;
font-src 'self' blob: data:; media-src 'self' blob: data:; worker-src 'self' blob:;
connect-src 'self' blob: data:; frame-src 'none'; object-src 'none';
base-uri 'none'; form-action 'none'
```

这意味着：

- **不允许内联 `<script>`** 和 `onclick="..."` 这类内联事件；脚本必须是插件目录里的文件。内联 `style` 属性和 `<style>` 标签可以用。
- 不允许 `eval` / `new Function`（WebAssembly 可以）。依赖库如有 `eval` 开关要关掉（例如 pdf.js 的 `isEvalSupported: false`）。
- Web Worker 只能从插件目录或 `blob:` 加载，ES module worker 可用。
- `fetch` 只能读插件自己目录内的文件（例如字体、wasm、CMap 数据）。
- 不能再嵌套 iframe，不能提交表单，不能加载外部图片/字体/脚本。
- 协议已识别的 MIME：`.html .js .mjs .css .json .wasm .svg .png .jpg .gif .woff .woff2 .ttf .otf .bcmap .pfb .map .txt`，其他扩展名按 `application/octet-stream` 返回。脚本请用 `.js` / `.mjs`。

### 4. 消息协议

所有消息都是 `postMessage` 的普通对象，`type` 字段以 `cr:` 开头。

**插件 → 主软件**（`window.parent.postMessage(msg, '*')`）：

| 消息 | 何时发送 |
|---|---|
| `{ type: 'cr:ready' }` | 页面脚本加载完成、已注册 `message` 监听之后，**必须发送**，否则收不到文件 |
| `{ type: 'cr:rendered' }` | 首屏内容渲染完成 |
| `{ type: 'cr:error', message }` | 无法预览（文件损坏、格式不支持、加密等）。`message` 是给普通用户看的中文说明，不要放堆栈 |

**主软件 → 插件**：

| 消息 | 说明 |
|---|---|
| `{ type: 'cr:file', name, ext, size, mime, theme, data }` | 收到 `cr:ready` 后发送。`ext` 为小写无点扩展名；`theme` 为 `'light'` 或 `'dark'`；`data` 是 `ArrayBuffer`（以 transfer 方式传入，插件独占） |
| `{ type: 'cr:theme', theme }` | 用户切换主题时发送 |

最小示例：

```js
window.addEventListener('message', async (e) => {
  if (e.source !== window.parent) return;
  const m = e.data || {};
  if (m.type === 'cr:file') {
    document.documentElement.dataset.theme = m.theme;
    try {
      await render(m.data, m.ext);              // 你的渲染逻辑
      parent.postMessage({ type: 'cr:rendered' }, '*');
    } catch (err) {
      parent.postMessage({ type: 'cr:error', message: '文件已损坏，或格式不受支持。' }, '*');
    }
  } else if (m.type === 'cr:theme') {
    document.documentElement.dataset.theme = m.theme;
  }
});
parent.postMessage({ type: 'cr:ready' }, '*');
```

内置插件把这一段封装在各自的 `bridge.js` 里（`CR.start({ onFile, onTheme })`），可以直接复制使用。

### 5. 界面约定

- 页面铺满 iframe（`100vw` × `100vh`），由插件自己负责滚动。
- 浅色 / 深色两套配色，用 `document.documentElement.dataset.theme` 切换。参考主软件配色：

| | 背景 | 文字 | 分隔线 | 强调色 |
|---|---|---|---|---|
| 浅色 | `#faf9f5` | `#2b2a27` | `#e4e0d5` | `#c96442` |
| 深色 | `#262624` | `#ecebe6` | `#3a3935` | `#d97757` |

- 字体：`"Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui`；等宽：`"Cascadia Mono", Consolas, "SF Mono", Menlo`。
- 界面文字用中文，不使用 emoji。
- 出错时除了发 `cr:error`，页面上也要显示错误说明，不要白屏。
- 链接无法在插件内打开，建议拦截 `<a>` 点击，避免 iframe 跳走。

### 6. 发布与增量更新

```bash
npm install
node scripts/build.js
```

脚本做三件事：从 `node_modules` 把第三方库拷进各插件的 `vendor/`；给每个插件的当前版本生成文件清单 `releases/<id>/<version>.json`；重写仓库根目录的 `index.json`。之后按脚本最后打印的命令提交、打 tag（`<id>-v<version>`）并推送。

文件清单逐个记录插件文件的路径、大小和 sha256：

```json
{ "schema": 2, "id": "code-viewer", "version": "1.0.1", "tag": "code-viewer-v1.0.1",
  "files": [ { "path": "app.js", "size": 9120, "sha256": "…" },
             { "path": "vendor/x.js", "size": 1362014, "sha256": "…", "urls": ["https://cdn.jsdelivr.net/npm/…"] } ] }
```

客户端安装或更新时逐个比对 sha256，**只下载变了的文件**，没变的直接复用本机已有的；插件文件从 tag 对应的 `plugins/<id>/…` 读取（GitHub 原站失败时依次换 jsDelivr 的几个节点），带 `urls` 的是不放在本仓库的外部文件，从给出的地址下载。每个文件下载后都校验大小和 sha256。

改了插件文件却没升 `manifest.json` 里的版本号，脚本会直接报错，避免同一版本出现两份不同内容。

### 7. 本地测试

`scripts/plugin-harness/` 是一个离屏 Electron 测试程序：原样使用主软件的 `src/plugin-protocol.js`（本目录有一份副本）注册 `crplugin://` 协议，按上面的消息协议把文件传给插件，等 `cr:rendered` / `cr:error` 后截图，同时收集插件 iframe 的 console 输出和所有非本地网络请求。不会弹出窗口。

```bash
# 单个文件
npx electron scripts/plugin-harness/main.js --plugin pdf-viewer --file a.pdf --theme dark --out a.png
# 批量（jobs.json 格式见 main.js 顶部注释），结果写到 <outdir>/results.json
npx electron scripts/plugin-harness/main.js --jobs jobs.json --outdir out/
# 测试已安装到某个目录的插件（<dir>/<id>/）
npx electron scripts/plugin-harness/main.js --jobs jobs.json --outdir out/ --plugins-dir <dir>
```

---

## English

Claude Remote previews files from the remote server through **preview plugins**. A plugin is a static web page (HTML + JS + CSS) running in an iframe that is isolated from the main UI: the app hands the file content to the plugin via `postMessage`, and the plugin renders it.

The five built-in plugins under `plugins/` are good reference implementations:

| id | Name | Extensions | Library |
|---|---|---|---|
| pdf-viewer | PDF 预览 | pdf | pdf.js |
| word-viewer | Word 预览 | docx | docx-preview |
| excel-viewer | 表格预览 | xlsx, xls, xlsm, ods, csv | SheetJS |
| ppt-viewer | 幻灯片预览 | pptx | pptx-preview |
| code-viewer | 代码与文本预览 | js, py, json, md, ... | highlight.js, marked, DOMPurify |

### 1. Layout

```
plugins/<id>/
├── manifest.json      required, plugin metadata
├── index.html         entry page (manifest.entry)
├── app.js             plugin script (any name)
├── style.css
└── vendor/            third-party libraries and their license files
```

- Every file must live inside the plugin directory. **No CDN references and no network requests** — the CSP blocks them.
- The directory name must equal `manifest.id`.

### 2. manifest.json

See the example in the Chinese section above. Fields:

| Field | Meaning |
|---|---|
| `id` | Unique id matching `^[a-z0-9][a-z0-9-]{0,63}$`; it is the host in `crplugin://<id>/` |
| `name` | Display name |
| `version` | Semantic version `x.y.z`; bump it on every release |
| `description` | One-sentence summary |
| `author` | Author |
| `license` | SPDX expression covering the plugin's own code and every bundled library |
| `extensions` | Array of lower-case extensions without the dot |
| `entry` | Entry HTML, relative to the plugin directory |
| `minAppVersion` | Minimum app version required |

When several plugins claim the same extension, the app decides which one wins (e.g. csv goes to excel-viewer first).

### 3. Loading and security restrictions

The app loads a plugin with `<iframe src="crplugin://<id>/index.html">`. `crplugin://<id>/<path>` maps to a file in the plugin directory. Each plugin is its own origin, cross-origin to the main UI, so it **cannot reach the main UI's DOM or Node.js**.

Every response carries the CSP shown in the Chinese section. In practice:

- **No inline `<script>`** and no inline event handlers (`onclick="..."`); scripts must be files in the plugin directory. Inline `style` attributes and `<style>` tags are fine.
- No `eval` / `new Function` (WebAssembly is allowed). Turn off eval-based features in libraries (e.g. pdf.js `isEvalSupported: false`).
- Web Workers may only come from the plugin directory or `blob:`; module workers work.
- `fetch` can only read the plugin's own files (fonts, wasm, CMap data, ...).
- No nested iframes, no form submission, no external images, fonts or scripts.
- Known MIME types: `.html .js .mjs .css .json .wasm .svg .png .jpg .gif .woff .woff2 .ttf .otf .bcmap .pfb .map .txt`; anything else is served as `application/octet-stream`. Use `.js` / `.mjs` for scripts.

### 4. Message protocol

All messages are plain objects sent with `postMessage`; `type` starts with `cr:`.

**Plugin → app** (`window.parent.postMessage(msg, '*')`):

| Message | When |
|---|---|
| `{ type: 'cr:ready' }` | After the script has loaded and the `message` listener is registered. **Required** — the file is only sent after it |
| `{ type: 'cr:rendered' }` | The first screen has been rendered |
| `{ type: 'cr:error', message }` | The file cannot be previewed (corrupted, unsupported, encrypted, ...). `message` is a user-facing explanation in Chinese, no stack traces |

**App → plugin**:

| Message | Meaning |
|---|---|
| `{ type: 'cr:file', name, ext, size, mime, theme, data }` | Sent after `cr:ready`. `ext` is lower-case without the dot; `theme` is `'light'` or `'dark'`; `data` is an `ArrayBuffer` (transferred, owned by the plugin) |
| `{ type: 'cr:theme', theme }` | Sent when the user switches theme |

See the minimal example in the Chinese section. The built-in plugins wrap it in `bridge.js` (`CR.start({ onFile, onTheme })`), which you can copy as is.

### 5. UI conventions

- Fill the iframe (`100vw` × `100vh`) and handle scrolling yourself.
- Provide light and dark palettes switched by `document.documentElement.dataset.theme` (colors in the table in the Chinese section).
- Fonts: `"Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui`; monospace: `"Cascadia Mono", Consolas, "SF Mono", Menlo`.
- UI text in Chinese, no emoji.
- On failure, besides sending `cr:error`, show the error on the page — never leave a blank screen.
- Links cannot be opened from inside a plugin; intercept `<a>` clicks so the iframe does not navigate away.

### 6. Releasing and incremental updates

```bash
npm install
node scripts/build.js
```

The script copies third-party libraries from `node_modules` into each plugin's `vendor/`, writes a per-file manifest `releases/<id>/<version>.json` for every plugin's current version, and rewrites `index.json`. Then commit, tag `<id>-v<version>` and push, using the commands it prints.

Each manifest lists every file's path, size and sha256 (format above). On install or update the app compares sha256 per file and **downloads only the files that changed**, reusing everything else from the local copy. Plugin files are read from `plugins/<id>/…` at the release tag (GitHub first, then jsDelivr mirrors); entries with `urls` are external files not stored in this repository and are fetched from those URLs. Every downloaded file is checked for size and sha256.

If a plugin's files changed but its `manifest.json` version did not, the script fails, so one version never has two different contents.

### 7. Local testing

`scripts/plugin-harness/` is an off-screen Electron test harness. It registers the `crplugin://` scheme with an unmodified copy of the app's `src/plugin-protocol.js`, delivers files with the protocol above, waits for `cr:rendered` / `cr:error`, takes a screenshot of the whole window, and records the plugin iframe's console output and any non-local network request. No window is shown. Usage is the same as in the Chinese section.
