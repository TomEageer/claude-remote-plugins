// Word 预览：docx-preview 按页面版式渲染 .docx
(() => {
  const $ = (id) => document.getElementById(id);
  const viewer = $('viewer');
  const host = $('doc');
  const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  let zoom = 1;
  let fit = 'auto'; // 'auto'：页面比窗口宽时缩小到适合宽度，否则 100%；'width'：适合宽度；null：手动
  let pageWidth = 0; // 最宽页面在 100% 下的宽度（含外层 padding）

  async function openFile(msg) {
    CR.showState('loading', '正在加载…');
    $('toolbar').hidden = true;
    host.textContent = '';
    host.style.zoom = '';
    if (!msg.data || !msg.data.byteLength) throw CR.userError('文件内容为空。');
    const head = new Uint8Array(msg.data, 0, Math.min(8, msg.data.byteLength));
    // 老式 .doc（OLE 复合文档）不支持
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
      throw CR.userError('这是旧版 Word 文档（.doc）格式，暂不支持预览，请另存为 .docx 后再试。');
    }
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw CR.userError('文件已损坏，或不是有效的 Word 文档（.docx）。');
    try {
      await docx.renderAsync(msg.data, host, null, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        experimental: true,
        useBase64URL: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderChanges: false,
        renderComments: false,
        renderAltChunks: false, // altChunk 依赖 iframe，CSP 禁止
      });
    } catch (err) {
      host.textContent = '';
      throw Object.assign(err instanceof Error ? err : new Error(String(err)),
        { userMessage: '文件已损坏，或不是有效的 Word 文档（.docx）。' });
    }
    fixSymbolGlyphs();
    const pages = host.querySelectorAll('section.docx');
    if (!pages.length) throw CR.userError('文档中没有可显示的内容。');
    host.style.zoom = '1';
    pageWidth = 0;
    pages.forEach((p) => { pageWidth = Math.max(pageWidth, p.offsetWidth); });
    pageWidth += 32;
    $('info').textContent = '共 ' + pages.length + ' 页';
    $('toolbar').hidden = false;
    CR.showState('hide');
    fit = 'auto';
    applyZoom(fitZoom());
    // 图片是 blob URL，等首屏图片解码完再通知已渲染
    await Promise.race([
      Promise.all([...host.querySelectorAll('img')].slice(0, 20).map((im) => im.decode().catch(() => {}))),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    CR.done();
  }

  // Word 的项目符号常用 Symbol / Wingdings 字体的私用区字符（如 U+F0B7），
  // macOS 等没有对应字体映射的系统上会显示成方框：换成等价的 Unicode 字符并去掉符号字体
  const PUA = {
    0xf0b7: '\u2022', 0xf0a7: '\u25aa', 0xf0a8: '\u25c6', 0xf06e: '\u25a0', 0xf06f: '\u25a1', 0xf071: '\u2751',
    0xf075: '\u25c6', 0xf076: '\u2756', 0xf0d8: '\u27a2', 0xf0e0: '\u2192', 0xf0e8: '\u2794', 0xf0fc: '\u2713',
    0xf0fb: '\u2717', 0xf0a1: '\u25cb', 0xf09f: '\u2022', 0xf06c: '\u25cf', 0xf02d: '\u2013',
  };
  const mapPua = (str) => str.replace(/[\uf000-\uf0ff]/g, (ch) => PUA[ch.charCodeAt(0)] || '\u2022');
  const SYMBOL_FONT = /font-family:\s*["']?(Symbol|Wingdings[^;"']*|Webdings)["']?\s*;?/gi;
  function fixSymbolGlyphs() {
    host.querySelectorAll('style').forEach((st) => {
      const css = st.textContent;
      if (!/[\uf000-\uf0ff]/.test(css)) return;
      // 只处理含私用区字符的规则块
      st.textContent = css.replace(/\{[^}]*\}/g, (block) =>
        /[\uf000-\uf0ff]/.test(block) ? mapPua(block).replace(SYMBOL_FONT, '') : block);
    });
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/[\uf000-\uf0ff]/.test(n.data) || n.parentElement.closest('style')) continue;
      n.data = mapPua(n.data);
      if (n.parentElement.style) n.parentElement.style.fontFamily = '';
    }
  }

  function fitZoom() {
    if (!pageWidth) return 1;
    const z = (viewer.clientWidth - 2) / pageWidth;
    return Math.max(0.3, Math.min(fit === 'auto' ? 1 : 3, z));
  }

  function applyZoom(z) {
    const ratio = viewer.scrollTop / Math.max(1, viewer.scrollHeight);
    zoom = Math.max(0.3, Math.min(3, z));
    host.style.zoom = String(zoom);
    viewer.scrollTop = ratio * viewer.scrollHeight;
    $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
    $('fitWidth').classList.toggle('active', fit === 'width');
    $('actual').classList.toggle('active', fit !== 'width' && Math.abs(zoom - 1) < 0.001);
  }

  // 外链不能在插件内打开，阻止跳转；文档内书签链接（#）保留
  host.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#')) e.preventDefault();
  });
  $('zoomIn').addEventListener('click', () => { fit = null; applyZoom(ZOOMS.find((z) => z > zoom + 0.001) || 3); });
  $('zoomOut').addEventListener('click', () => { fit = null; applyZoom([...ZOOMS].reverse().find((z) => z < zoom - 0.001) || 0.3); });
  $('fitWidth').addEventListener('click', () => { fit = 'width'; applyZoom(fitZoom()); });
  $('actual').addEventListener('click', () => { fit = null; applyZoom(1); });
  viewer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    fit = null;
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (fit) applyZoom(fitZoom()); }, 150); });

  CR.start({ onFile: openFile });
})();
