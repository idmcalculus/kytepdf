import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailCollectionModal } from "../../components/EmailCollectionModal";

if (!customElements.get("email-modal")) {
  customElements.define("email-modal", EmailCollectionModal);
}

describe("EmailCollectionModal", () => {
  let modal: EmailCollectionModal;

  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '<div id="globalDialog"></div>';
    (document.getElementById("globalDialog") as any).show = vi.fn();
    modal = new EmailCollectionModal();
    document.body.appendChild(modal);
  });

  it("should be hidden by default", () => {
    const overlay = modal.querySelector(".kyte-overlay");
    expect(overlay?.classList.contains("hidden")).toBe(true);
  });

  it("should show when show() is called", () => {
    modal.show();
    const overlay = modal.querySelector(".kyte-overlay");
    expect(overlay?.classList.contains("hidden")).toBe(false);
  });

  it("should validate email format", () => {
    modal.show();
    const input = modal.querySelector('input[type="email"]') as HTMLInputElement;
    const submitBtn = modal.querySelector("#submitEmail") as HTMLButtonElement;

    input.value = "invalid-email";
    submitBtn.click();
    // In a real implementation, we might check for an error message or prevented event
    expect(input.checkValidity()).toBe(false);

    input.value = "test@example.com";
    expect(input.checkValidity()).toBe(true);
  });

  it("should emit 'email-submitted' event with email on success", async () => {
    const spy = vi.fn();
    modal.addEventListener("email-submitted", spy);

    modal.show();
    const input = modal.querySelector('input[type="email"]') as HTMLInputElement;
    const submitBtn = modal.querySelector("#submitEmail") as HTMLButtonElement;

    input.value = "test@example.com";
    submitBtn.click();

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0].detail.email).toBe("test@example.com");
  });

  it("should emit 'modal-dismissed' when skipped", () => {
    const spy = vi.fn();
    modal.addEventListener("modal-dismissed", spy);

    modal.show();
    const skipBtn = modal.querySelector("#skipEmail") as HTMLButtonElement;
    skipBtn.click();

    expect(spy).toHaveBeenCalled();
  });

  it("resolves submitted and skipped values and supports privacy/backdrop actions", async () => {
    vi.useFakeTimers();
    const dialog = document.getElementById("globalDialog") as any;

    (modal.querySelector("#privacyPolicyLink") as HTMLAnchorElement).click();
    expect(dialog.show).toHaveBeenCalledWith(expect.objectContaining({ title: "Privacy Policy" }));

    const submitted = modal.show();
    const input = modal.querySelector("#userEmail") as HTMLInputElement;
    input.value = "person@example.com";
    (modal.querySelector("#emailForm") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    vi.advanceTimersByTime(300);
    await expect(submitted).resolves.toBe("person@example.com");

    const skipped = modal.show();
    const overlay = modal.querySelector("#emailOverlay") as HTMLElement;
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    vi.advanceTimersByTime(300);
    await expect(skipped).resolves.toBeNull();
    vi.useRealTimers();
  });
});
