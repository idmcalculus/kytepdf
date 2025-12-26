import "./style.css";
import "./components/ToolDashboard.ts";
import "./components/PdfCompressor.ts";
import "./components/PdfMerge.ts";
import "./components/PdfSplit.ts";
import "./components/PdfSign.ts";
import "./components/pdf-editor/PdfEditor.ts";
import "./components/KyteDialog.ts";
import { mapError } from "./utils/errorMapper.ts";
import { logger } from "./utils/logger.ts";

logger.info("KytePDF Application Starting");

// Global Safety Nets (Production-Grade Error Handling)
window.onerror = (message, source, lineno, colno, error) => {
  logger.error("Unhandled runtime error", { message, source, lineno, colno, error: error?.stack });
  const dialog = document.getElementById("globalDialog") as any;
  if (dialog) {
    const userFriendlyMsg = mapError(
      error || (message as string),
      "An unexpected application error occurred. We have logged the issue and are looking into it.",
    );
    dialog.show({
      title: "Something went wrong",
      message: userFriendlyMsg,
      type: "error",
    });
  }
  return false;
};

window.onunhandledrejection = (event) => {
  logger.error("Unhandled Promise Rejection", { reason: event.reason });
  const dialog = document.getElementById("globalDialog") as any;
  if (dialog) {
    const userFriendlyMsg = mapError(
      event.reason,
      "An asynchronous operation failed unexpectedly. Please refresh and try again.",
    );
    dialog.show({
      title: "Operation Failed",
      message: userFriendlyMsg,
      type: "error",
    });
  }
};

const mainContainer = document.getElementById("main-container") as HTMLElement;

function showDashboard() {
  mainContainer.innerHTML = "<tool-dashboard></tool-dashboard>";
}

function showCompressor() {
  mainContainer.innerHTML = "<pdf-compressor></pdf-compressor>";
}

function showMerge() {
  mainContainer.innerHTML = "<pdf-merge></pdf-merge>";
}

function showSplit() {
  mainContainer.innerHTML = "<pdf-split></pdf-split>";
}

function showSign() {
  mainContainer.innerHTML = "<pdf-sign></pdf-sign>";
}

function showEdit() {
  mainContainer.innerHTML = "<pdf-editor></pdf-editor>";
}

// Router logic - listening for custom events from our web components
window.addEventListener("tool-select", (e: any) => {
  logger.info("Tool selected", { toolId: e.detail.toolId });
  if (e.detail.toolId === "compress") {
    showCompressor();
  } else if (e.detail.toolId === "merge") {
    showMerge();
  } else if (e.detail.toolId === "split") {
    showSplit();
  } else if (e.detail.toolId === "sign") {
    showSign();
  } else if (e.detail.toolId === "edit") {
    showEdit();
  }
});

window.addEventListener("back-to-dashboard", () => {
  showDashboard();
});

// Initial Load
showDashboard();

// Interactive Background Logic
const canvas = document.getElementById("bg-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
let particles: Particle[] = [];
const mouse = { x: null as number | null, y: null as number | null };

window.addEventListener("mousemove", (e) => {
  mouse.x = e.x;
  mouse.y = e.y;
});

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

class Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;

  constructor() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.size = Math.random() * 2 + 1;
    this.speedX = Math.random() * 1 - 0.5;
    this.speedY = Math.random() * 1 - 0.5;
  }
  update() {
    this.x += this.speedX;
    this.y += this.speedY;

    if (this.x > canvas.width) this.x = 0;
    if (this.x < 0) this.x = canvas.width;
    if (this.y > canvas.height) this.y = 0;
    if (this.y < 0) this.y = canvas.height;

    // Mouse interaction
    if (mouse.x && mouse.y) {
      const dx = mouse.x - this.x;
      const dy = mouse.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 100) {
        this.x -= dx / 20;
        this.y -= dy / 20;
      }
    }
  }
  draw() {
    ctx.fillStyle = "rgba(6, 182, 212, 0.4)";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function init() {
  particles = [];
  for (let i = 0; i < 80; i++) {
    particles.push(new Particle());
  }
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < particles.length; i++) {
    particles[i].update();
    particles[i].draw();

    for (let j = i; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 150) {
        ctx.strokeStyle = `rgba(16, 185, 129, ${1 - distance / 150})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
      }
    }
  }
  requestAnimationFrame(animate);
}

init();
animate();
