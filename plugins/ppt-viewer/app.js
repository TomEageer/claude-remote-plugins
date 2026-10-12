// 幻灯片预览：pptx-preview 以固定宽度渲染单页，再用 CSS zoom 适配窗口；工具栏/方向键翻页
(() => {
  const $ = (id) => document.getElementById(id);
  const viewer = $('viewer');
  const host = $('slides');
  const RENDER_WIDTH = 960; // 渲染基准宽度（px），显示时按窗口缩放
  const PAD = 44; // .slides 四周 padding 之和 + 余量

  let previewer = null;

  async function openFile(msg) {
    CR.showState('loading', '正在加载…');
    $('toolbar').hidden = true;
    destroy();
    if (!msg.data || !msg.data.byteLength) throw CR.userError('文件内容为空。');
    const head = new Uint8Array(msg.data, 0, Math.min(4, msg.data.byteLength));
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
      throw CR.userError('这是旧版 PowerPoint 文档（.ppt）格式，暂不支持预览，请另存为 .pptx 后再试。');
    }
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw CR.userError('文件已损坏，或不是有效的 PowerPoint 文档（.pptx）。');

    previewer = pptxPreview.init(host, { width: RENDER_WIDTH, mode: 'slide' });
    try {
      await previewer.preview(msg.data);
    } catch (err) {
      destroy();
      throw Object.assign(err instanceof Error ? err : new Error(String(err)),
        { userMessage: '文件已损坏，或不是有效的 PowerPoint 文档（.pptx）。' });
    }
    if (!previewer.slideCount) {
      destroy();
      throw CR.userError('演示文稿中没有幻灯片。');
    }
    $('toolbar').hidden = false;
    CR.showState('hide');
    fit();
    update();
    CR.done();
  }

  function destroy() {
    if (previewer) { try { previewer.destroy(); } catch (_) { /* ignore */ } }
    previewer = null;
    host.textContent = '';
  }

  // 按窗口大小缩放当前页，宽高都放得下（zoom 加在库的外层容器上，不影响四周留白）
  function fit() {
    if (!previewer) return;
    const wrap = host.querySelector('.pptx-preview-wrapper');
    const slide = host.querySelector('.pptx-preview-slide-wrapper');
    if (!wrap || !slide) return;
    wrap.style.zoom = '1';
    const w = slide.offsetWidth || RENDER_WIDTH;
    const h = slide.offsetHeight || RENDER_WIDTH * 9 / 16;
    const z = Math.min((viewer.clientWidth - PAD) / w, (viewer.clientHeight - PAD) / h);
    wrap.style.zoom = String(Math.max(0.1, Math.min(3, z)));
  }

  function update() {
    if (!previewer) return;
    const i = previewer.currentIndex;
    const n = previewer.slideCount;
    $('pageLabel').textContent = (i + 1) + ' / ' + n;
    $('first').disabled = $('prev').disabled = i <= 0;
    $('last').disabled = $('next').disabled = i >= n - 1;
  }

  function go(index) {
    if (!previewer) return;
    const n = previewer.slideCount;
    index = Math.max(0, Math.min(n - 1, index));
    if (index === previewer.currentIndex) return;
    try {
      if (index === previewer.currentIndex + 1) previewer.renderNextSlide();
      else if (index === previewer.currentIndex - 1) previewer.renderPreSlide();
      else {
        previewer.removeCurrentSlide();
        previewer.currentIndex = index;
        previewer.renderSingleSlide(index);
        previewer.updatePagination && previewer.updatePagination();
      }
    } catch (err) {
      console.error('[ppt-viewer] 第 ' + (index + 1) + ' 页渲染失败', err);
    }
    fit();
    update();
  }

  $('first').addEventListener('click', () => go(0));
  $('prev').addEventListener('click', () => go(previewer.currentIndex - 1));
  $('next').addEventListener('click', () => go(previewer.currentIndex + 1));
  $('last').addEventListener('click', () => go(previewer.slideCount - 1));
  document.addEventListener('keydown', (e) => {
    if (!previewer) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') go(previewer.currentIndex + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') go(previewer.currentIndex - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(previewer.slideCount - 1);
    else return;
    e.preventDefault();
  });
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(fit, 120); });

  CR.start({ onFile: openFile });
})();
