import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudConsentModal } from "../../components/CloudConsentModal";

if (!customElements.get("cloud-consent-modal")) {
  customElements.define("cloud-consent-modal", CloudConsentModal);
}

describe("CloudConsentModal", () => {
  let modal: CloudConsentModal;

  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn();
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

  it("opens policy details and dismisses from the backdrop", async () => {
    vi.useFakeTimers();
    const dialog = document.getElementById("globalDialog") as any;

    (modal.querySelector("#cloudPrivacyLink") as HTMLAnchorElement).click();
    expect(dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Cloud Data Policy" }),
    );

    const promise = modal.show();
    const overlay = modal.querySelector("#consentOverlay") as HTMLElement;
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlay.classList.contains("active")).toBe(false);
    vi.advanceTimersByTime(300);
    expect(overlay.classList.contains("hidden")).toBe(true);
    await expect(promise).resolves.toBe(false);
    vi.useRealTimers();
  });
});
