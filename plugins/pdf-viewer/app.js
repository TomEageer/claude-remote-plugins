// PDF 预览：pdf.js 逐页 canvas 渲染（只渲染可视区附近的页），支持缩放与页码跳转
import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

const VENDOR = new URL('./vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const viewer = $('viewer');
const pagesEl = $('pages');
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const PAD = 32; // .pages 左右 padding 之和

let doc = null;
let loadingTask = null;
let baseSize = { w: 612, h: 792 }; // 第 1 页在 100% 下的 CSS 像素尺寸
let scale = 1;
let fitMode = 'width'; // 'width' | 'page' | null
let slots = [];        // [{ el, pageNo, rendered, task, w, h }]
let observer = null;
let generation = 0;    // 每次缩放/换文件自增，丢弃过期的渲染

function describePdfError(err) {
  const name = err && err.name;
  if (name === 'PasswordException') return '该 PDF 设置了打开密码，暂不支持预览。';
  if (name === 'InvalidPDFException') return '文件已损坏，或不是有效的 PDF 文档。';
  if (name === 'MissingPDFException') return '文件内容为空。';
  return CR.describe(err);
}

async function openFile(msg) {
  CR.showState('loading', '正在加载…');
  await closeDoc();
  if (!msg.data || !msg.data.byteLength) throw CR.userError('文件内容为空。');

  loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(msg.data),
    cMapUrl: VENDOR + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: VENDOR + 'standard_fonts/',
    wasmUrl: VENDOR + 'wasm/',
    iccUrl: VENDOR + 'iccs/',
    isEvalSupported: false,
    enableXfa: false,
  });
  loadingTask.onPassword = () => {
    const e = new Error('password'); e.name = 'PasswordException';
    loadingTask.destroy();
    failOnce(e);
  };
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    failOnce(err);
    return;
  }
  const first = await doc.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  // pdf 的 1pt = 1/72in，CSS 的 1px = 1/96in
  baseSize = { w: vp.width * 96 / 72, h: vp.height * 96 / 72 };

  $('pageCount').textContent = '/ ' + doc.numPages;
  $('toolbar').hidden = false;
  CR.showState('hide');
  fitMode = 'width';
  scale = fitScale('width');
  buildSlots();
  updateUi();
}

let failed = false;
function failOnce(err) {
  if (failed) return;
  failed = true;
  $('toolbar').hidden = true;
  CR.fail(describePdfError(err), err);
}

async function closeDoc() {
  failed = false;
  generation++;
  if (observer) observer.disconnect();
  slots = [];
  pagesEl.textContent = '';
  if (loadingTask) { try { await loadingTask.destroy(); } catch (_) { /* ignore */ } }
  loadingTask = null;
  doc = null;
}

function fitScale(mode) {
  const w = viewer.clientWidth - PAD - 2;
  const h = viewer.clientHeight - PAD;
  let s = w / baseSize.w;
  if (mode === 'page') s = Math.min(s, h / baseSize.h);
  return Math.max(0.1, Math.min(5, s));
}

function buildSlots() {
  const gen = ++generation;
  if (observer) observer.disconnect();
  pagesEl.textContent = '';
  slots = [];
  observer = new IntersectionObserver(onIntersect, { root: viewer, rootMargin: '150% 0px' });
  for (let i = 1; i <= doc.numPages; i++) {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(i);
    const slot = { el, pageNo: i, rendered: false, task: null, w: baseSize.w, h: baseSize.h, gen };
    sizeSlot(slot);
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i);
    el.appendChild(num);
    pagesEl.appendChild(el);
    slots.push(slot);
    observer.observe(el);
  }
}

function sizeSlot(slot) {
  slot.el.style.width = Math.floor(slot.w * scale) + 'px';
  slot.el.style.height = Math.floor(slot.h * scale) + 'px';
}

function onIntersect(entries) {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const slot = slots[Number(en.target.dataset.page) - 1];
    if (slot && !slot.rendered) renderSlot(slot);
  }
}

async function renderSlot(slot) {
  slot.rendered = true;
  const gen = generation;
  try {
    const page = await doc.getPage(slot.pageNo);
    if (gen !== generation) return;
    const vp1 = page.getViewport({ scale: 96 / 72 });
    if (Math.abs(vp1.width - slot.w) > 0.5 || Math.abs(vp1.height - slot.h) > 0.5) {
      slot.w = vp1.width; slot.h = vp1.height; sizeSlot(slot);
    }
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * 96 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    const ctx = canvas.getContext('2d', { alpha: false });
    slot.task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    await slot.task.promise;
    if (gen !== generation) return;
    slot.el.textContent = '';
    slot.el.appendChild(canvas);
    if (slot.pageNo === 1 || !CR.rendered) CR.done();
  } catch (err) {
    if (err && err.name === 'RenderingCancelledException') return;
    if (gen !== generation) return;
    console.error('[pdf-viewer] 第 ' + slot.pageNo + ' 页渲染失败', err);
    slot.el.querySelector('.num') && (slot.el.querySelector('.num').textContent = '第 ' + slot.pageNo + ' 页渲染失败');
    if (!CR.rendered) failOnce(err);
  } finally {
    slot.task = null;
  }
}

function setScale(next, mode = null) {
  if (!doc) return;
  next = Math.max(0.1, Math.min(5, next));
  fitMode = mode;
  if (Math.abs(next - scale) < 0.001) { updateUi(); return; }
  // 记住当前阅读位置（相对于页面高度的比例），缩放后恢复
  const anchor = currentPage();
  const slot = slots[anchor - 1];
  const offsetRatio = slot ? (viewer.scrollTop - slot.el.offsetTop) / slot.el.offsetHeight : 0;
  scale = next;
  generation++;
  for (const s of slots) {
    if (s.task) { try { s.task.cancel(); } catch (_) { /* ignore */ } }
    s.rendered = false;
    sizeSlot(s);
    s.el.textContent = '';
    const num = document.createElement('span'); num.className = 'num'; num.textContent = String(s.pageNo);
    s.el.appendChild(num);
    // 重新触发可视检测
    observer.unobserve(s.el); observer.observe(s.el);
  }
  if (slot) viewer.scrollTop = slot.el.offsetTop + offsetRatio * slot.el.offsetHeight;
  updateUi();
}

function currentPage() {
  if (!slots.length) return 1;
  const mid = viewer.scrollTop + viewer.clientHeight / 3;
  let lo = 0, hi = slots.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (slots[m].el.offsetTop <= mid) lo = m; else hi = m - 1;
  }
  return lo + 1;
}

function goPage(n) {
  if (!doc) return;
  n = Math.max(1, Math.min(doc.numPages, n | 0));
  viewer.scrollTop = slots[n - 1].el.offsetTop - 8;
  updateUi(n);
}

function updateUi(page) {
  if (!doc) return;
  const p = page || currentPage();
  if (document.activeElement !== $('pageInput')) $('pageInput').value = String(p);
  $('prev').disabled = p <= 1;
  $('next').disabled = p >= doc.numPages;
  $('zoomLabel').textContent = Math.round(scale * 100) + '%';
  $('fitWidth').classList.toggle('active', fitMode === 'width');
  $('fitPage').classList.toggle('active', fitMode === 'page');
}

$('prev').addEventListener('click', () => goPage(currentPage() - 1));
$('next').addEventListener('click', () => goPage(currentPage() + 1));
$('zoomIn').addEventListener('click', () => setScale(ZOOMS.find((z) => z > scale + 0.001) || 5));
$('zoomOut').addEventListener('click', () => setScale([...ZOOMS].reverse().find((z) => z < scale - 0.001) || 0.1));
$('fitWidth').addEventListener('click', () => setScale(fitScale('width'), 'width'));
$('fitPage').addEventListener('click', () => setScale(fitScale('page'), 'page'));
$('pageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { goPage(parseInt($('pageInput').value, 10) || 1); $('pageInput').blur(); }
  if (e.key === 'Escape') { $('pageInput').blur(); updateUi(); }
});
$('pageInput').addEventListener('blur', () => updateUi());
viewer.addEventListener('scroll', () => updateUi(), { passive: true });
viewer.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setScale(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.target === $('pageInput')) return;
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.shiftKey)) { goPage(currentPage() + 1); e.preventDefault(); }
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.shiftKey)) { goPage(currentPage() - 1); e.preventDefault(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { $('zoomIn').click(); e.preventDefault(); }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { $('zoomOut').click(); e.preventDefault(); }
});
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (fitMode) setScale(fitScale(fitMode), fitMode); }, 150);
});

CR.start({ onFile: openFile });
