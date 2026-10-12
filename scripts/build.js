#!/usr/bin/env node
// 插件发布脚本（在本仓库根目录运行）
//
//   npm install
//   node scripts/build.js
//
// 1. vendor：从 node_modules 拷第三方库到各插件 vendor/
// 2. release：给每个插件的当前版本生成文件清单 releases/<id>/<version>.json（逐文件 sha256），
//    并重写 index.json。客户端按文件清单做增量更新：只下载 sha256 变了的文件。
// 3. 之后手动 git commit，给新版本打 tag `<id>-v<version>` 并 push（脚本最后会打印命令）。
//
// pptx-preview 的作者允许使用其 npm 包，但不允许把代码发布到网上，所以它不进本仓库
// （.gitignore），文件清单里写成"外部文件"，客户端直接从 npm CDN 下载并校验 sha256。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PLUGINS = path.join(ROOT, 'plugins');
const NM = path.join(ROOT, 'node_modules');
const REPO = 'TomEageer/claude-remote-plugins';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VER_RE = /^\d+\.\d+\.\d+$/;
const REQUIRED = ['id', 'name', 'version', 'description', 'author', 'license', 'extensions', 'entry', 'minAppVersion'];
const SKIP = new Set(['.DS_Store', 'Thumbs.db']);

// 不进仓库、由客户端从 npm CDN 下载的文件
function externalFiles() {
  const v = require(path.join(NM, 'pptx-preview', 'package.json')).version;
  const f = 'dist/pptx-preview.umd.js';
  return {
    'ppt-viewer': {
      'vendor/pptx-preview.umd.js': [
        `https://cdn.jsdelivr.net/npm/pptx-preview@${v}/${f}`,
        `https://fastly.jsdelivr.net/npm/pptx-preview@${v}/${f}`,
        `https://gcore.jsdelivr.net/npm/pptx-preview@${v}/${f}`,
        `https://unpkg.com/pptx-preview@${v}/${f}`,
      ],
    },
  };
}

// ---------------------------------------------------------------- vendor

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d, filter);
    else if (filter(ent.name)) fs.copyFileSync(s, d);
  }
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function vendor() {
  const nm = (...p) => path.join(NM, ...p);
  const plug = (...p) => path.join(PLUGINS, ...p);

  // pdf-viewer: pdf.js 主模块 + worker + CMap（中文等非嵌入字体必需）+ 标准字体 + 图像解码 wasm
  {
    const v = plug('pdf-viewer', 'vendor', 'pdfjs');
    resetDir(v);
    copy(nm('pdfjs-dist', 'build', 'pdf.min.mjs'), path.join(v, 'pdf.min.mjs'));
    copy(nm('pdfjs-dist', 'build', 'pdf.worker.min.mjs'), path.join(v, 'pdf.worker.min.mjs'));
    copyDir(nm('pdfjs-dist', 'cmaps'), path.join(v, 'cmaps'));
    copyDir(nm('pdfjs-dist', 'standard_fonts'), path.join(v, 'standard_fonts'));
    copyDir(nm('pdfjs-dist', 'iccs'), path.join(v, 'iccs'));
    // 只要 wasm 解码器和许可证；不带 JS 脚本引擎（quickjs）和无 wasm 回退
    copyDir(nm('pdfjs-dist', 'wasm'), path.join(v, 'wasm'),
      (n) => /^(openjpeg|jbig2|qcms_bg)\.wasm$/.test(n) || n.startsWith('LICENSE'));
    copy(nm('pdfjs-dist', 'LICENSE'), path.join(v, 'LICENSE'));
  }

  // word-viewer: docx-preview（UMD，依赖全局 JSZip）
  {
    const v = plug('word-viewer', 'vendor');
    resetDir(v);
    copy(nm('jszip', 'dist', 'jszip.min.js'), path.join(v, 'jszip.min.js'));
    copy(nm('jszip', 'LICENSE.markdown'), path.join(v, 'LICENSE-jszip.md'));
    copy(nm('docx-preview', 'dist', 'docx-preview.min.js'), path.join(v, 'docx-preview.min.js'));
    copy(nm('docx-preview', 'LICENSE'), path.join(v, 'LICENSE-docx-preview'));
  }

  // excel-viewer: SheetJS 官方发行版 0.20.x（full 版带中文代码页，xls / GBK csv 需要）
  {
    const v = plug('excel-viewer', 'vendor');
    resetDir(v);
    copy(nm('xlsx', 'dist', 'xlsx.full.min.js'), path.join(v, 'xlsx.full.min.js'));
    copy(nm('xlsx', 'LICENSE'), path.join(v, 'LICENSE-sheetjs'));
  }

  // ppt-viewer: pptx-preview 的 UMD 包已内联 jszip / echarts / lodash / uuid / tslib
  {
    const v = plug('ppt-viewer', 'vendor');
    resetDir(v);
    copy(nm('pptx-preview', 'dist', 'pptx-preview.umd.js'), path.join(v, 'pptx-preview.umd.js'));
    fs.writeFileSync(path.join(v, 'LICENSE-pptx-preview'),
      'pptx-preview ' + require(nm('pptx-preview', 'package.json')).version +
      ' - npm package license: ISC (https://www.npmjs.com/package/pptx-preview)\n' +
      'Bundled: jszip (MIT), echarts (Apache-2.0), lodash (MIT), uuid (MIT), tslib (0BSD)\n\n' +
      'Terms from the pptx-preview README: the published npm package may be used free of charge for\n' +
      'personal and commercial purposes; its source code may not be republished. This plugin ships the\n' +
      'unmodified npm build only inside the plugin package; it is not stored in the Claude Remote repository.\n');
  }

  // code-viewer: highlight.js（common 语言集 + powershell + dos）用 esbuild 打成 IIFE；marked + DOMPurify
  {
    const v = plug('code-viewer', 'vendor');
    resetDir(v);
    const esbuild = require('esbuild');
    esbuild.buildSync({
      stdin: {
        contents: [
          "import hljs from 'highlight.js/lib/common';",
          "import powershell from 'highlight.js/lib/languages/powershell';",
          "import dos from 'highlight.js/lib/languages/dos';",
          "hljs.registerLanguage('powershell', powershell);",
          "hljs.registerLanguage('dos', dos);",
          'window.hljs = hljs;',
        ].join('\n'),
        resolveDir: ROOT,
        sourcefile: 'hljs-entry.js',
      },
      bundle: true,
      minify: true,
      format: 'iife',
      target: 'chrome120',
      legalComments: 'inline',
      outfile: path.join(v, 'highlight.min.js'),
    });
    copy(nm('highlight.js', 'LICENSE'), path.join(v, 'LICENSE-highlight.js'));
    copy(nm('marked', 'lib', 'marked.umd.js'), path.join(v, 'marked.umd.js'));
    copy(nm('marked', 'LICENSE'), path.join(v, 'LICENSE-marked'));
    copy(nm('dompurify', 'dist', 'purify.min.js'), path.join(v, 'purify.min.js'));
    copy(nm('dompurify', 'LICENSE'), path.join(v, 'LICENSE-dompurify'));
  }
  console.log('vendor/ 已刷新');
}

// ---------------------------------------------------------------- release

function readManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const miss = REQUIRED.filter((k) => m[k] === undefined || m[k] === '');
  if (miss.length) throw new Error(`${file} 缺少字段: ${miss.join(', ')}`);
  if (!ID_RE.test(m.id)) throw new Error(`${file} id 不合法: ${m.id}`);
  if (m.id !== path.basename(dir)) throw new Error(`${file} id (${m.id}) 必须与目录名一致`);
  if (!VER_RE.test(m.version)) throw new Error(`${file} version 必须是 x.y.z: ${m.version}`);
  if (!Array.isArray(m.extensions) || !m.extensions.length ||
      m.extensions.some((e) => typeof e !== 'string' || !/^[a-z0-9]+$/.test(e))) {
    throw new Error(`${file} extensions 必须是小写无点扩展名数组`);
  }
  if (!fs.existsSync(path.join(dir, m.entry))) throw new Error(`${file} entry 文件不存在: ${m.entry}`);
  return m;
}

function listFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listFiles(p, base, out);
    else if (ent.isFile()) out.push(path.relative(base, p));
  }
  return out;
}

function listFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listFiles(p, base, out);
    else if (ent.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function release() {
  const ext = externalFiles();
  const dirs = fs.readdirSync(PLUGINS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PLUGINS, d.name, 'manifest.json')))
    .map((d) => path.join(PLUGINS, d.name))
    .sort();
  const index = { schema: 2, repo: REPO, updated: new Date().toISOString(), plugins: [] };
  const newTags = [];
  for (const dir of dirs) {
    const m = readManifest(dir);
    const files = listFiles(dir).map((rel) => {
      const buf = fs.readFileSync(path.join(dir, rel));
      const entry = { path: rel, size: buf.length, sha256: sha256(buf) };
      if (ext[m.id] && ext[m.id][rel]) entry.urls = ext[m.id][rel];
      return entry;
    });
    const rel = { schema: 2, id: m.id, version: m.version, tag: `${m.id}-v${m.version}`, files };
    const relFile = path.join(ROOT, 'releases', m.id, `${m.version}.json`);
    const text = JSON.stringify(rel, null, 1) + '\n';
    if (fs.existsSync(relFile)) {
      if (fs.readFileSync(relFile, 'utf8') !== text) {
        throw new Error(`${m.id} 的文件变了但版本号还是 ${m.version}，请先在 manifest.json 里升版本`);
      }
    } else {
      fs.mkdirSync(path.dirname(relFile), { recursive: true });
      fs.writeFileSync(relFile, text);
      newTags.push(rel.tag);
    }
    const size = files.reduce((n, f) => n + f.size, 0);
    index.plugins.push({
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      extensions: m.extensions,
      author: m.author,
      license: m.license,
      minAppVersion: m.minAppVersion,
      size,
      files: files.length,
      tag: rel.tag,
      release: `releases/${m.id}/${m.version}.json`,
      // 商店列表直接带上图标（data URI，客户端只当图片显示）
      icon: m.icon && fs.existsSync(path.join(dir, m.icon))
        ? `data:image/svg+xml;base64,${fs.readFileSync(path.join(dir, m.icon)).toString('base64')}` : undefined,
    });
    console.log(`${(m.id + ' ' + m.version).padEnd(24)} ${String(files.length).padStart(4)} 个文件 ${(size / 1024).toFixed(0).padStart(6)} KB`);
  }
  fs.writeFileSync(path.join(ROOT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`index.json 已更新，共 ${index.plugins.length} 个插件`);
  if (newTags.length) {
    console.log('\n新版本，提交后执行：');
    console.log('  git add -A && git commit -m "release: ' + newTags.join(', ') + '"');
    for (const t of newTags) console.log(`  git tag ${t}`);
    console.log('  git push origin main --tags');
    console.log('  # 让 jsDelivr 镜像立即刷新商店列表（否则分支缓存最长 12 小时）');
    console.log(`  curl -s https://purge.jsdelivr.net/gh/${REPO}@main/index.json`);
  }
}

try {
  vendor();
  release();
} catch (e) {
  console.error('失败: ' + e.message);
  process.exit(1);
}
