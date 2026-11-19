import { Flipbook } from './Flipbook.js';

// <flip-book src="catalog.pdf"></flip-book>
// Drop-in element. The Flipbook instance is on element.book for full control.
class FlipBookElement extends HTMLElement {
  static observedAttributes = ['src'];
  connectedCallback() {
    if (!this.style.display) this.style.display = 'block';
    if (getComputedStyle(this).position === 'static') this.style.position = 'relative';
    this.book = new Flipbook(this, {
      sound: !this.hasAttribute('muted'),
      wheelZoom: this.hasAttribute('wheel-zoom'),
      coverColor: this.getAttribute('cover-color') || undefined,
    });
    ['ready', 'flip', 'progress'].forEach((t) =>
      this.book.addEventListener(t, (e) => this.dispatchEvent(new CustomEvent(t, { detail: e.detail })))
    );
    if (this.getAttribute('src')) this.book.load(this.getAttribute('src'));
  }
  attributeChangedCallback(name, old, val) {
    if (name === 'src' && this.book && old !== val && val) this.book.load(val);
  }
  disconnectedCallback() { this.book?.destroy(); this.book = null; }
  next() { this.book?.next(); }
  prev() { this.book?.prev(); }
  goToPage(n) { this.book?.goToPage(n); }
}

if (!customElements.get('flip-book')) customElements.define('flip-book', FlipBookElement);
export { FlipBookElement };
