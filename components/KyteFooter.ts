export class KyteFooter extends HTMLElement {
	connectedCallback() {
		this.render();
	}

	render() {
		this.innerHTML = `
      <footer>
        <div class="footer-content">
          <div class="footer-branding">
            KytePDF by <a href="https://jaydeetechltd.com" target="_blank" rel="noopener">Jaydeetech</a>
          </div>
          <div class="footer-credits">
            Developed with love by <a href="https://github.com/idmcalculus" target="_blank" rel="noopener">idmcalculus</a>
            <span class="social-links">
              (<a href="https://github.com/idmcalculus" target="_blank" rel="noopener">GitHub</a>,
              <a href="https://linkedin.com/in/idmcalculus" target="_blank" rel="noopener">LinkedIn</a>,
              <a href="https://twitter.com/idmcalculus" target="_blank" rel="noopener">Twitter</a>)
            </span>
          </div>
          <div class="footer-support">
            <a href="https://www.buymeacoffee.com/idmcalculus" target="_blank" rel="noopener" class="coffee-btn">
              Buy me a coffee
            </a>
          </div>
          <div class="footer-legal">
            © 2025 Jaydeetech Ltd
          </div>
        </div>
      </footer>
    `;
	}
}

if (!customElements.get("kyte-footer")) {
	customElements.define("kyte-footer", KyteFooter);
}
