import { SYMBOLS } from "./logic";

const STRIP = [...SYMBOLS, ...SYMBOLS, ...SYMBOLS]; // three copies so the strip can scroll
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Reels {
  private cols: HTMLElement[];
  constructor(root: HTMLElement) {
    root.innerHTML = "";
    this.cols = [0, 1, 2].map(() => {
      const col = document.createElement("div");
      col.className = "reel";
      const strip = document.createElement("div");
      strip.className = "strip";
      for (const s of STRIP) {
        const cell = document.createElement("div");
        cell.className = `cell sym-${s.name}`;
        const img = document.createElement("img");
        img.src = s.image;
        img.alt = s.label;
        img.draggable = false;
        cell.appendChild(img);
        strip.appendChild(cell);
      }
      col.appendChild(strip);
      root.appendChild(col);
      return col;
    });
    this.showIdle();
  }

  start(): void {
    this.cols.forEach((c, i) => {
      c.classList.remove("win");
      c.classList.add("spinning");
      (c.firstElementChild as HTMLElement).style.animationDelay = `${i * 120}ms`;
    });
  }

  /** Stop each reel on its symbol, left to right, resolving after the last one lands. */
  async stopOn(reels: [number, number, number]): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const col = this.cols[i];
      const strip = col.firstElementChild as HTMLElement;
      col.classList.remove("spinning");
      // middle copy of the strip: index 6 + symbol, cell height from CSS var
      strip.style.transition = reduced() ? "none" : "transform 600ms cubic-bezier(.2,.9,.3,1.2)";
      strip.style.transform = `translateY(calc(-1 * (${6 + reels[i]}) * var(--cell)))`;
      await new Promise((r) => setTimeout(r, reduced() ? 0 : 650));
    }
  }

  markWin(): void { this.cols.forEach((c) => c.classList.add("win")); }

  showIdle(): void {
    this.cols.forEach((c, i) => {
      c.classList.remove("spinning", "win");
      const strip = c.firstElementChild as HTMLElement;
      strip.style.transition = "none";
      strip.style.transform = `translateY(calc(-1 * (${6 + ((i * 2) % 6)}) * var(--cell)))`;
    });
  }
}
