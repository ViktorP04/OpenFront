import { TileScatterPass } from "./TileScatterPass";

/** Sparse integer texture updates; full uploads supersede queued patches. */
export class IntegerTextureUpdates {
  private readonly scatter: TileScatterPass;
  private readonly tiles = new Set<number>();
  private source: Uint8Array | Uint16Array | null = null;
  private fullPending = false;
  private rowMin = Infinity;
  private rowMax = -1;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly width: number,
    private readonly height: number,
    private readonly texture: WebGLTexture,
    private readonly componentType: number,
  ) {
    this.scatter = new TileScatterPass(gl, width, height, texture);
  }

  full(source: Uint8Array | Uint16Array): void {
    this.source = source;
    this.fullPending = true;
    this.tiles.clear();
    this.rowMin = Infinity;
    this.rowMax = -1;
  }

  patch(source: Uint8Array | Uint16Array, refs: readonly number[]): void {
    this.source = source;
    if (!this.fullPending) for (const ref of refs) this.tiles.add(ref);
  }

  rows(source: Uint8Array | Uint16Array, min: number, max: number): void {
    this.source = source;
    if (this.fullPending || max < min || max < 0) return;
    this.rowMin = Math.min(this.rowMin, min);
    this.rowMax = Math.max(this.rowMax, max);
  }

  /** Call before screen rendering: scatter changes framebuffer/viewport/blend. */
  flush(): void {
    const source = this.source;
    if (
      !source ||
      (!this.fullPending && this.rowMax < 0 && this.tiles.size === 0)
    )
      return;
    const gl = this.gl;
    // At high density, uploading the texture is cheaper than 12 bytes/point.
    if (this.fullPending || this.tiles.size * 12 >= source.byteLength) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.width,
        this.height,
        gl.RED_INTEGER,
        this.componentType,
        source,
      );
    } else {
      if (this.rowMax >= 0) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          this.rowMin,
          this.width,
          this.rowMax - this.rowMin + 1,
          gl.RED_INTEGER,
          this.componentType,
          source.subarray(
            this.rowMin * this.width,
            (this.rowMax + 1) * this.width,
          ),
        );
      }
      // Read latest live values at flush, so multiple updates before a render
      // (including clear/reveal/hide) never replay stale queued values.
      for (const ref of this.tiles)
        this.scatter.push(
          ref % this.width,
          Math.floor(ref / this.width),
          source[ref],
        );
      this.scatter.flush();
    }
    this.fullPending = false;
    this.tiles.clear();
    this.rowMin = Infinity;
    this.rowMax = -1;
  }

  dispose(): void {
    this.scatter.dispose();
  }
}
