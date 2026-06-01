// Minimal type shim for opentype.js — covers just the surface we use
// in textGlyphs.ts. Upstream package ships untyped runtime JS.

declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z';
    x?: number; y?: number;
    x1?: number; y1?: number;
    x2?: number; y2?: number;
  }

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    advanceWidth?: number;
  }

  export interface Font {
    ascender: number;
    descender: number;
    unitsPerEm: number;
    charToGlyph(ch: string): Glyph;
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
    getPaths(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean }): Path[];
  }

  export function parse(buffer: ArrayBuffer): Font;
}
