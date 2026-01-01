import { telemetry } from "../utils/telemetry.ts";

export class EmailCollectionModal extends HTMLElement {
	private activeResolve: ((value: string | null) => void) | null = null;

	connectedCallback() {
		this.render();
	}

	render() {
		this.innerHTML = `
      <div id="emailOverlay" class="kyte-overlay hidden">
        <div class="kyte-modal email-modal">
          <div class="kyte-modal-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5C2 7 4 5 6.5 5H17.5C20 5 22 7 22 9.5V17Z"/><path d="m2 9 10 7 10-7"/></svg>
          </div>
          <h2>Join the Kyte Community</h2>
          <p>Get notified about new features, secure your username early, and be first in line for cloud storage & history sync.</p>
          
          <form id="emailForm" class="email-form">
            <div class="input-group">
              <input type="email" id="userEmail" placeholder="Enter your email" required />
            </div>
            <div class="kyte-modal-actions">
              <button type="button" id="skipEmail" class="btn btn-secondary">Maybe Later</button>
              <button type="submit" id="submitEmail" class="btn btn-primary">Keep Me Updated</button>
            </div>
          </form>
          
          <p class="privacy-note">Privacy first: We only use your email for product updates and account features. Read our <a href="#" id="privacyPolicyLink">Privacy Policy</a>.</p>
        </div>
      </div>
    `;

		const form = this.querySelector("#emailForm") as HTMLFormElement;
		const skipBtn = this.querySelector("#skipEmail") as HTMLElement;
		const privacyLink = this.querySelector("#privacyPolicyLink") as HTMLElement;

		privacyLink.onclick = (e) => {
			e.preventDefault();
			const dialog = document.getElementById("globalDialog") as any;
			dialog.show({
				title: "Privacy Policy",
				message:
					"KytePDF is built with a privacy-first mindset. Your documents are processed locally in your browser and are never uploaded to our servers. Email addresses are stored securely and used only for the purposes you opt into.",
				type: "info",
			});
		};

		form.onsubmit = (e) => {
			e.preventDefault();
			const email = (this.querySelector("#userEmail") as HTMLInputElement).value;
			this.handleSubmit(email);
		};

		skipBtn.onclick = () => this.handleSkip();

		this.querySelector("#emailOverlay")?.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).id === "emailOverlay") this.handleSkip();
		});
	}

	show(): Promise<string | null> {
		const overlay = this.querySelector("#emailOverlay") as HTMLElement;
		overlay.classList.remove("hidden");
		overlay.classList.add("active");
		this.querySelector("input")?.focus();

		return new Promise((resolve) => {
			this.activeResolve = resolve;
		});
	}

	private handleSubmit(email: string) {
		telemetry.logEvent("growth", "email_signup", { email_provided: true });
		this.dispatchEvent(new CustomEvent("email-submitted", { detail: { email }, bubbles: true }));
		this.close(email);
	}

	private handleSkip() {
		telemetry.logEvent("growth", "email_signup_skipped", { email_provided: false });
		this.dispatchEvent(new CustomEvent("modal-dismissed", { bubbles: true }));
		this.close(null);
	}

	private close(value: string | null) {
		const overlay = this.querySelector("#emailOverlay") as HTMLElement;
		overlay.classList.remove("active");
		setTimeout(() => overlay.classList.add("hidden"), 300);
		if (this.activeResolve) {
			this.activeResolve(value);
			this.activeResolve = null;
		}
	}
}

if (!customElements.get("email-modal")) {
	customElements.define("email-modal", EmailCollectionModal);
}
