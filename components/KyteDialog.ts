import type { DialogOptions } from "./BaseComponent.ts";

export class KyteDialog extends HTMLElement {
  private activeResolve: ((value: boolean) => void) | null = null;

  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <div id="kyteOverlay" class="kyte-overlay hidden">
        <div id="kyteModal" class="kyte-modal">
          <div id="kyteIcon" class="kyte-modal-icon"></div>
          <h2 id="kyteTitle"></h2>
          <p id="kyteMessage"></p>
          <div class="kyte-modal-actions">
            <button id="kyteCancelBtn" class="btn btn-secondary hidden">Cancel</button>
            <button id="kyteConfirmBtn" class="btn btn-primary">OK</button>
          </div>
        </div>
      </div>
    `;

    (this.querySelector("#kyteConfirmBtn") as HTMLElement).onclick = () => this.handleAction(true);
    (this.querySelector("#kyteCancelBtn") as HTMLElement).onclick = () => this.handleAction(false);
    (this.querySelector("#kyteOverlay") as HTMLElement).onclick = (e) => {
      if ((e.target as HTMLElement).id === "kyteOverlay") this.handleAction(false);
    };
  }

  show({
    title,
    message,
    type = "info",
    confirmText = "OK",
    cancelText = "Cancel",
    showCancel = false,
  }: DialogOptions) {
    const overlay = this.querySelector("#kyteOverlay") as HTMLElement;
    const modal = this.querySelector("#kyteModal") as HTMLElement;
    const titleEl = this.querySelector("#kyteTitle") as HTMLElement;
    const messageEl = this.querySelector("#kyteMessage") as HTMLElement;
    const iconEl = this.querySelector("#kyteIcon") as HTMLElement;
    const confirmBtn = this.querySelector("#kyteConfirmBtn") as HTMLElement;
    const cancelBtn = this.querySelector("#kyteCancelBtn") as HTMLElement;

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText || "OK";
    cancelBtn.textContent = cancelText || "Cancel";

    if (showCancel) cancelBtn.classList.remove("hidden");
    else cancelBtn.classList.add("hidden");

    // Set Icon/Theme
    iconEl.innerHTML = this.getIcon(type);
    modal.className = `kyte-modal kyte-modal-${type}`;

    overlay.classList.remove("hidden");
    overlay.classList.add("active");

    return new Promise<boolean>((resolve) => {
      this.activeResolve = resolve;
    });
  }

  handleAction(confirmed: boolean) {
    const overlay = this.querySelector("#kyteOverlay") as HTMLElement;
    overlay.classList.remove("active");
    setTimeout(() => overlay.classList.add("hidden"), 300);
    if (this.activeResolve) {
      this.activeResolve(confirmed);
      this.activeResolve = null;
    }
  }

  getIcon(type: string) {
    const icons: Record<string, string> = {
      success:
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error:
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
      warning:
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
      info: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    };
    return icons[type] || icons.info;
  }
}

customElements.define("kyte-dialog", KyteDialog);
