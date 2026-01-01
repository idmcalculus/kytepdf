import { beforeEach, describe, expect, it } from "vitest";
import { AboutModal } from "../../components/AboutModal";

if (!customElements.get("about-modal")) {
  customElements.define("about-modal", AboutModal);
}

describe("AboutModal", () => {
  let modal: AboutModal;

  beforeEach(() => {
    modal = new AboutModal();
    document.body.appendChild(modal);
  });

  it("should be hidden by default", () => {
    const overlay = modal.querySelector("#aboutOverlay");
    expect(overlay?.classList.contains("hidden")).toBe(true);
  });

  it("should show when show() is called", () => {
    modal.show();
    const overlay = modal.querySelector("#aboutOverlay");
    expect(overlay?.classList.contains("hidden")).toBe(false);
    expect(overlay?.classList.contains("active")).toBe(true);
  });

  it("should contain the project copy", () => {
    expect(modal.textContent).toContain("KytePDF was born from a desire");
    expect(modal.textContent).toContain("locally in your browser");
  });

  it("should contain credits and social links", () => {
    expect(modal.querySelector('a[href*="github.com/idmcalculus"]')).toBeTruthy();
    expect(modal.querySelector('a[href*="linkedin.com"]')).toBeTruthy();
  });

  it("should contain the Buy me a coffee button", () => {
    expect(modal.querySelector(".coffee-btn")).toBeTruthy();
  });

  it("should hide when hide() is called", async () => {
    modal.show();
    modal.hide();
    const overlay = modal.querySelector("#aboutOverlay");
    expect(overlay?.classList.contains("active")).toBe(false);
  });
});
