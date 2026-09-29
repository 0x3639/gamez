import { SYMBOLS } from "./logic";

const COPIES = 7;                       // enough strip to decelerate through five full cycles
const STRIP = Array.from({ length: COPIES }, () => SYMBOLS).flat();
const IDLE_COPY = 1;                    // resting position lives in the second copy
const STOP_COPY = 6;                    // the stop travels from copy 0 to copy 6: 36 cells of slow-down
const STOP_MS = 2400;                   // per-reel deceleration
const STAGGER_MS = 900;                 // left to right
const SETTLE_PAUSE_MS = 150;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function cellOffset(index: number): string {
  return `translateY(calc(-1 * ${index} * var(--cell)))`;
}

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

  /**
   * Stop each reel on its symbol, left to right, resolving after the last one lands.
   * Each reel jumps (invisibly, mid-blur) to the top copy of the strip and then eases
   * through six cycles to its symbol, so the slow-down is long and readable.
   */
  async stopOn(reels: [number, number, number]): Promise<void> {
    const motion = !reduced();
    const stops = this.cols.map((col, i) => new Promise<void>((done) => {
      setTimeout(() => {
        const strip = col.firstElementChild as HTMLElement;
        col.classList.remove("spinning");
        if (!motion) {
          strip.style.transition = "none";
          strip.style.transform = cellOffset(IDLE_COPY * 6 + reels[i]);
          done();
          return;
        }
        strip.style.transition = "none";
        strip.style.transform = cellOffset(reels[i]);          // copy 0, same symbol
        void strip.offsetHeight;                               // commit the jump before animating
        strip.style.transition = `transform ${STOP_MS}ms cubic-bezier(.25, .6, .3, 1), filter 600ms ease-out`;
        strip.style.transform = cellOffset(STOP_COPY * 6 + reels[i]);
        setTimeout(done, STOP_MS + SETTLE_PAUSE_MS);
      }, motion ? i * STAGGER_MS : 0);
    }));
    await Promise.all(stops);
    // Park on the idle copy without motion so a later spin animation starts from a known spot.
    this.cols.forEach((col, i) => {
      const strip = col.firstElementChild as HTMLElement;
      strip.style.transition = "none";
      strip.style.transform = cellOffset(IDLE_COPY * 6 + reels[i]);
    });
  }

  markWin(): void { this.cols.forEach((c) => c.classList.add("win")); }

  showIdle(): void {
    this.cols.forEach((c, i) => {
      c.classList.remove("spinning", "win");
      const strip = c.firstElementChild as HTMLElement;
      strip.style.transition = "none";
      strip.style.transform = cellOffset(IDLE_COPY * 6 + ((i * 2) % 6));
    });
  }
}
