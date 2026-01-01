import { telemetry } from "../utils/telemetry.ts";

export class CloudConsentModal extends HTMLElement {
  private activeResolve: ((value: boolean) => void) | null = null;

  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <div id="consentOverlay" class="kyte-overlay hidden">
        <div class="kyte-modal consent-modal">
          <div class="kyte-modal-icon" style="color: var(--primary);">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a3.5 3.5 0 0 0 .5-6.91V11a5 5 0 0 0-10 0v1.09a3.5 3.5 0 0 0 .5 6.91Z"/><path d="M12 13v4"/><path d="m10 15 2 2 2-2"/></svg>
          </div>
          <h2>Cloud Processing Required</h2>
          <p>This conversion is complex and requires secure cloud processing. To maintain your privacy:</p>
          <ul style="text-align: left; margin: 1.5rem 0; color: var(--text-muted); font-size: 0.9rem; line-height: 1.6;">
            <li>✅ Files are encrypted during transit.</li>
            <li>✅ Data is processed on privacy-compliant servers.</li>
            <li>✅ Files are permanently deleted immediately after conversion.</li>
          </ul>
          
          <div class="kyte-modal-actions">
            <button id="cancelConsent" class="btn btn-secondary">Cancel</button>
            <button id="acceptConsent" class="btn btn-primary">Accept & Continue</button>
          </div>
          
          <p class="privacy-note">By continuing, you agree to our <a href="#" id="cloudPrivacyLink">Cloud Data Handling policy</a>.</p>
        </div>
      </div>
    `;

    const acceptBtn = this.querySelector("#acceptConsent") as HTMLElement;
    const cancelBtn = this.querySelector("#cancelConsent") as HTMLElement;
    const privacyLink = this.querySelector("#cloudPrivacyLink") as HTMLElement;

    privacyLink.onclick = (e) => {
      e.preventDefault();
      const dialog = document.getElementById("globalDialog") as any;
      dialog.show({
        title: "Cloud Data Policy",
        message:
          "KytePDF uses industry-standard encryption (AES-256) to protect your files. We do not store your documents longer than necessary for the conversion process (typically less than 5 minutes).",
        type: "info",
      });
    };

    acceptBtn.onclick = () => this.handleAction(true);
    cancelBtn.onclick = () => this.handleAction(false);

    this.querySelector("#consentOverlay")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).id === "consentOverlay") this.handleAction(false);
    });
  }

  show(): Promise<boolean> {
    const overlay = this.querySelector("#consentOverlay") as HTMLElement;
    overlay.classList.remove("hidden");
    overlay.classList.add("active");

    return new Promise((resolve) => {
      this.activeResolve = resolve;
    });
  }

  private handleAction(confirmed: boolean) {
    telemetry.logEvent("privacy", "cloud_consent_action", { confirmed });
    const overlay = this.querySelector("#consentOverlay") as HTMLElement;
    overlay.classList.remove("active");
    setTimeout(() => overlay.classList.add("hidden"), 300);

    if (this.activeResolve) {
      this.activeResolve(confirmed);
      this.activeResolve = null;
    }
  }
}

if (!customElements.get("cloud-consent-modal")) {
  customElements.define("cloud-consent-modal", CloudConsentModal);
}
