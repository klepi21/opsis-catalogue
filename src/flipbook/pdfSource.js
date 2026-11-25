import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Loads a PDF and renders pages to canvases on demand, one at a time,
// nearest-first, so the pages around the reader are always sharp first.
export class PdfSource {
  constructor() {
    this.doc = null;
    this.queue = [];
    this.busy = false;
    this.cache = new Map(); // key -> Promise<canvas>
  }

  async open(src, onProgress) {
    const params = typeof src === 'string' ? { url: src } : { data: src };
    const task = pdfjsLib.getDocument(params);
    if (onProgress) task.onProgress = (p) => p.total && onProgress(p.loaded / p.total);
    this.doc = await task.promise;
    const first = await this.doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    this.aspect = vp.height / vp.width;
    this.numPages = this.doc.numPages;
    return this;
  }

  /** Render page (1-based) so that its height is `height` px (and exactly `width` px wide when given). */
  render(pageNo, height, priority = 0, width = 0) {
    const key = pageNo + '@' + height + (width ? 'x' + width : '');
    if (this.cache.has(key)) return this.cache.get(key);
    const p = new Promise((resolve, reject) => {
      this.queue.push({ pageNo, height, width, key, priority, resolve, reject });
    });
    this.cache.set(key, p);
    this.pump();
    return p;
  }

  forget(pageNo, height, width = 0) { this.cache.delete(pageNo + '@' + height + (width ? 'x' + width : '')); }

  /** re-rank queued jobs (fn returns null to drop a job that is no longer needed) */
  reprioritize(fn) {
    const keep = [];
    for (const job of this.queue) {
      const p = fn(job.pageNo, job.height);
      if (p == null) { this.cache.delete(job.key); job.reject(new Error('dropped')); }
      else { job.priority = p; keep.push(job); }
    }
    this.queue = keep;
  }

  async pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    this.queue.sort((a, b) => a.priority - b.priority);
    const job = this.queue.shift();
    try {
      const page = await this.doc.getPage(job.pageNo);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: job.height / vp1.height });
      const canvas = document.createElement('canvas');
      canvas.width = job.width || Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // exact pixel size: stretch the few tenths of a pixel the rounding leaves
      const sx = canvas.width / vp.width, sy = canvas.height / vp.height;
      await page.render({ canvasContext: ctx, viewport: vp, transform: [sx, 0, 0, sy, 0, 0] }).promise;
      job.resolve(canvas);
    } catch (e) {
      job.reject(e);
    }
    this.busy = false;
    this.pump();
  }

  destroy() { this.doc?.destroy(); this.queue = []; this.cache.clear(); }
}
