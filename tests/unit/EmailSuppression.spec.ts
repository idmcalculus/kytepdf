import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseComponent } from "../../components/BaseComponent";

class TestComponent extends BaseComponent {
	protected toolKey = "test-tool";
	render() { this.innerHTML = '<div id="emailModal"></div>'; }
}

if (!customElements.get("suppression-test")) {
	customElements.define("suppression-test", TestComponent);
}

describe("Email Suppression State Machine", () => {
	let component: TestComponent;
	let mockModal: any;

	beforeEach(() => {
		localStorage.clear();
		document.body.innerHTML = '<email-modal id="emailModal"></email-modal>';
		mockModal = document.getElementById("emailModal");
		mockModal.show = vi.fn();
		component = new TestComponent();
		document.body.appendChild(component);
	});

	it("should show prompt on first try", async () => {
		mockModal.show.mockResolvedValue(null);
		await component.ensureEmailCollected();
		expect(mockModal.show).toHaveBeenCalled();
	});

	it("should set N=3 and Counter=1 after first dismissal", async () => {
		mockModal.show.mockResolvedValue(null);
		await component.ensureEmailCollected();
		
		expect(localStorage.getItem("kyte_email_suppression_n")).toBe("3");
		expect(localStorage.getItem("kyte_email_op_counter")).toBe("1");
	});

	it("should suppress for 3 operations after first dismissal", async () => {
		// 1. First dismissal
		mockModal.show.mockResolvedValue(null);
		await component.ensureEmailCollected();
		mockModal.show.mockClear();

		// 2. Op 2 (Counter becomes 2)
		await component.ensureEmailCollected();
		expect(mockModal.show).not.toHaveBeenCalled();
		expect(localStorage.getItem("kyte_email_op_counter")).toBe("2");

		// 3. Op 3 (Counter becomes 3)
		await component.ensureEmailCollected();
		expect(mockModal.show).not.toHaveBeenCalled();
		expect(localStorage.getItem("kyte_email_op_counter")).toBe("3");

		// 4. Op 4 (Counter was 3, N is 3 -> Should show)
		// We need a fresh component instance or reset hasAskedForEmail
		const freshComponent = new TestComponent();
		await freshComponent.ensureEmailCollected();
		expect(mockModal.show).toHaveBeenCalled();
	});

	it("should increment N to 4 after second dismissal", async () => {
		// Mock N=3, Counter=3 (ready to show)
		localStorage.setItem("kyte_email_suppression_n", "3");
		localStorage.setItem("kyte_email_op_counter", "3");
		mockModal.show.mockResolvedValue(null);

		await component.ensureEmailCollected();
		
		expect(localStorage.getItem("kyte_email_suppression_n")).toBe("4");
		expect(localStorage.getItem("kyte_email_op_counter")).toBe("1");
	});

	it("should reset N to 3 after reaching 10", async () => {
		// Mock N=10, Counter=10
		localStorage.setItem("kyte_email_suppression_n", "10");
		localStorage.setItem("kyte_email_op_counter", "10");
		mockModal.show.mockResolvedValue(null);

		await component.ensureEmailCollected();
		
		expect(localStorage.getItem("kyte_email_suppression_n")).toBe("3");
	});

	it("should stop asking if email is collected", async () => {
		localStorage.setItem("kyte_email_collected", "true");
		await component.ensureEmailCollected();
		expect(mockModal.show).not.toHaveBeenCalled();
	});
});
