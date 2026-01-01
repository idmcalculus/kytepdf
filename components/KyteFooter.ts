export class KyteFooter extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <footer>
        <div class="footer-content centered">
          <div class="footer-branding">
            KytePDF by <a href="https://jaydeetechltd.com" target="_blank" rel="noopener">Jaydeetech</a>
            <span class="footer-divider">|</span>
            <span class="footer-legal">© 2025 Jaydeetech Ltd</span>
          </div>
        </div>
      </footer>
    `;
  }
}

if (!customElements.get("kyte-footer")) {
  customElements.define("kyte-footer", KyteFooter);
}
