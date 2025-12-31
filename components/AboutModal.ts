export class AboutModal extends HTMLElement {
	connectedCallback() {
		this.render();
	}

	render() {
		this.innerHTML = `
      <div id="aboutOverlay" class="kyte-overlay hidden">
        <div class="kyte-modal about-modal">
          <div class="about-header">
            <h2>About KytePDF</h2>
            <button id="closeAbout" class="btn-close">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div class="about-content">
            <p class="about-copy">
              KytePDF was born from a desire to make PDF tools fast, private, and accessible. 
              We believe your documents should never leave your device unless you want them to. 
              That's why everything happens locally in your browser.
            </p>
            
            <div class="about-credits">
              <p>Developed with love by <a href="https://github.com/idmcalculus" target="_blank" rel="noopener">idmcalculus</a></p>
              <div class="social-icons">
                <a href="https://github.com/idmcalculus" target="_blank" rel="noopener" title="GitHub">GitHub</a>
                <a href="https://linkedin.com/in/idmcalculus" target="_blank" rel="noopener" title="LinkedIn">LinkedIn</a>
                <a href="https://twitter.com/idmcalculus" target="_blank" rel="noopener" title="Twitter">Twitter</a>
              </div>
            </div>

            <div class="about-support">
              <p class="support-text">If you find this tool useful, consider supporting independent, privacy-focused development.</p>
              <a href="https://www.buymeacoffee.com/idmcalculus" target="_blank" rel="noopener" class="coffee-btn">
                ☕ Buy me a coffee
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

		this.querySelector("#closeAbout")?.addEventListener("click", () => this.hide());
		this.querySelector("#aboutOverlay")?.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).id === "aboutOverlay") this.hide();
		});
	}

	show() {
		const overlay = this.querySelector("#aboutOverlay") as HTMLElement;
		overlay.classList.remove("hidden");
		overlay.classList.add("active");
	}

	hide() {
		const overlay = this.querySelector("#aboutOverlay") as HTMLElement;
		overlay.classList.remove("active");
		setTimeout(() => overlay.classList.add("hidden"), 300);
	}
}

if (!customElements.get("about-modal")) {
	customElements.define("about-modal", AboutModal);
}
