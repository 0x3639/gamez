import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SYMBOLS } from "./logic";

const pub = join(__dirname, "..", "public");

describe("reel artwork", () => {
  for (const s of SYMBOLS) {
    it(`${s.name} exists, is square SVG, and has no external references`, () => {
      const file = join(pub, s.image);
      expect(existsSync(file), file).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toMatch(/viewBox="0 0 (\d+) \1"/);      // square
      expect(svg).not.toMatch(/href=|url\(|<image|<script/i);   // self-contained, no raster, no scripts
      expect(svg.length).toBeLessThan(12_000);           // hand-drawn flat art, not an exported bitmap
    });
  }
});
