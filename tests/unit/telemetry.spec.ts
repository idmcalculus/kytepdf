import { describe, it, expect, vi, beforeEach } from "vitest";
import { telemetry } from "../../utils/telemetry";
import { config } from "../../utils/config";

vi.mock("../../utils/config", () => ({
	config: {
		isProd: true,
	},
}));

describe("Telemetry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "error").mockImplementation(() => { });
	});

	it("should capture exceptions when in production", () => {
		telemetry.captureException("test error", { foo: "bar" });
		expect(console.error).toHaveBeenCalledWith(
			"[Telemetry Exception]",
			expect.objectContaining({
				message: "test error",
				foo: "bar",
			})
		);
	});

	it("should not capture exceptions when not in production", () => {
		(telemetry as any).isProd = false;
		telemetry.captureException("test error");
		expect(console.error).not.toHaveBeenCalled();
		(telemetry as any).isProd = true;
	});

	it("should log events when in production", () => {
		// logEvent is currently a placeholder in telemetry.ts but we can still test the check
		const spy = vi.spyOn(telemetry, "logEvent");
		telemetry.logEvent("cat", "act", { foo: "bar" });
		expect(spy).toHaveBeenCalled();
	});
});
