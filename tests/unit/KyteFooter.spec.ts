import { beforeEach, describe, expect, it } from "vitest";
import { KyteFooter } from "../../components/KyteFooter";

if (!customElements.get("kyte-footer")) {
  customElements.define("kyte-footer", KyteFooter);
}

describe("KyteFooter", () => {
  let footer: KyteFooter;

  beforeEach(() => {
    footer = new KyteFooter();
    document.body.appendChild(footer);
  });

  it("should render Jaydeetech branding with correct link", () => {
    const brandingLink = footer.querySelector(
      'a[href="https://jaydeetechltd.com"]',
    ) as HTMLAnchorElement;
    expect(brandingLink).toBeTruthy();
    expect(brandingLink.textContent).toContain("Jaydeetech");
  });

  it("should render the copyright notice for 2025", () => {
    expect(footer.textContent).toContain("© 2025 Jaydeetech Ltd");
  });

  it("should have centered content class", () => {
    expect(footer.querySelector(".footer-content.centered")).toBeTruthy();
  });
});
