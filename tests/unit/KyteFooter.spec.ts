import { describe, it, expect, beforeEach } from "vitest";
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
		const brandingLink = footer.querySelector('a[href="https://jaydeetechltd.com"]') as HTMLAnchorElement;
		expect(brandingLink).toBeTruthy();
		expect(brandingLink.textContent).toContain("Jaydeetech");
	});

	it("should render credits for idmcalculus with links", () => {
		const credits = footer.innerHTML;
		expect(credits).toContain("Developed with love by");
		expect(footer.querySelector('a[href*="github.com/idmcalculus"]')).toBeTruthy();
		expect(footer.querySelector('a[href*="linkedin.com"]')).toBeTruthy();
		expect(footer.querySelector('a[href*="twitter.com"]')).toBeTruthy();
	});

	it("should render a 'Buy me a coffee' button/link", () => {
		const coffeeLink = footer.querySelector('a[href*="buymeacoffee.com"]') || footer.querySelector('.coffee-btn');
		expect(coffeeLink).toBeTruthy();
	});

	it("should render the copyright notice for 2025", () => {
		expect(footer.textContent).toContain("© 2025 Jaydeetech Ltd");
	});
});
