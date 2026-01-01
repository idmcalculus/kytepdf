import { describe, it, expect, beforeEach, vi } from "vitest";
import { CloudConsentModal } from "../../components/CloudConsentModal";

if (!customElements.get("cloud-consent-modal")) {
  customElements.define("cloud-consent-modal", CloudConsentModal);
}

describe("CloudConsentModal", () => {
  let modal: CloudConsentModal;

  beforeEach(() => {
    document.body.innerHTML = '<div id="globalDialog"></div>';
    modal = new CloudConsentModal();
    document.body.appendChild(modal);
  });

  it("should be hidden by default", () => {
    const overlay = modal.querySelector("#consentOverlay");
    expect(overlay?.classList.contains("hidden")).toBe(true);
  });

  it("should return true when accepted", async () => {
    const promise = modal.show();
    const acceptBtn = modal.querySelector("#acceptConsent") as HTMLElement;
    acceptBtn.click();
    
    const result = await promise;
    expect(result).toBe(true);
  });

  it("should return false when cancelled", async () => {
    const promise = modal.show();
    const cancelBtn = modal.querySelector("#cancelConsent") as HTMLElement;
    cancelBtn.click();
    
    const result = await promise;
    expect(result).toBe(false);
  });
});
