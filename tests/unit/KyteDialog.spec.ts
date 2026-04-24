import { beforeEach, describe, expect, it, vi } from "vitest";
import { KyteDialog } from "../../components/KyteDialog";

describe("KyteDialog", () => {
  let dialog: KyteDialog;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    dialog = new KyteDialog();
    document.body.appendChild(dialog);
    dialog.connectedCallback();
  });

  it("renders hidden by default", () => {
    expect(dialog.querySelector("#kyteOverlay")?.classList.contains("hidden")).toBe(true);
    expect(dialog.querySelector("#kyteConfirmBtn")?.textContent).toBe("OK");
  });

  it("shows content, theme, icon, and custom button labels", () => {
    dialog.show({
      cancelText: "No",
      confirmText: "Yes",
      message: "Proceed?",
      showCancel: true,
      title: "Confirm action",
      type: "warning",
    });

    expect(dialog.querySelector("#kyteTitle")?.textContent).toBe("Confirm action");
    expect(dialog.querySelector("#kyteMessage")?.textContent).toBe("Proceed?");
    expect(dialog.querySelector("#kyteConfirmBtn")?.textContent).toBe("Yes");
    expect(dialog.querySelector("#kyteCancelBtn")?.textContent).toBe("No");
    expect(dialog.querySelector("#kyteCancelBtn")?.classList.contains("hidden")).toBe(false);
    expect(dialog.querySelector("#kyteModal")?.className).toContain("kyte-modal-warning");
    expect(dialog.querySelector("#kyteIcon")?.innerHTML).toContain("M12 9v4");
  });

  it("resolves true when confirmed and hides after transition", async () => {
    const promise = dialog.show({
      message: "Done",
      title: "Success",
      type: "success",
    });

    (dialog.querySelector("#kyteConfirmBtn") as HTMLButtonElement).click();

    await expect(promise).resolves.toBe(true);
    expect(dialog.querySelector("#kyteOverlay")?.classList.contains("active")).toBe(false);
    vi.advanceTimersByTime(300);
    expect(dialog.querySelector("#kyteOverlay")?.classList.contains("hidden")).toBe(true);
  });

  it("resolves false when cancelled or overlay is clicked", async () => {
    const cancelPromise = dialog.show({
      message: "Cancel?",
      showCancel: true,
      title: "Cancel action",
    });
    (dialog.querySelector("#kyteCancelBtn") as HTMLButtonElement).click();
    await expect(cancelPromise).resolves.toBe(false);

    const overlayPromise = dialog.show({ message: "Overlay?", title: "Overlay action" });
    dialog.querySelector("#kyteOverlay")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(overlayPromise).resolves.toBe(false);
  });

  it("falls back to the info icon for unknown types", () => {
    expect(dialog.getIcon("unknown")).toContain("M12 16v-4");
    expect(dialog.getIcon("error")).toContain('y1="8"');
  });
});
