/**
 * TrailPass — boat + nuke trail lines.
 *
 * Owns sparse pixel updates (and legacy row uploads) and the trail
 * fragment shader that draws the colored breadcrumb behind moving units.
 * Trail state itself (R16UI: 0=none, bits 0-11=ownerID, bit 12=nuke trail)
 * is referenced from the caller's array, not copied.
 */

import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize, MAX_TRAIL_COLORS } from "../utils/ColorUtils";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";
import { IntegerTextureUpdates } from "./IntegerTextureUpdates";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import trailFragSrc from "../shaders/map-overlay/trail.frag.glsl?raw";

export class TrailPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uTrailAlpha: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private trailTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private effectTex: WebGLTexture;
  private affiliationTex: WebGLTexture | null = null;
  private altView = false;
  // Anchor animation time at construction (like NukeTelegraphPass/SamRadiusPass)
  // so the value stays small and sin()/fract() don't quantize over long sessions.
  private readonly startTime = performance.now();

  private readonly updates: IntegerTextureUpdates;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    trailTex: WebGLTexture,
    paletteTex: WebGLTexture,
    effectTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.updates = new IntegerTextureUpdates(
      gl,
      mapW,
      mapH,
      trailTex,
      gl.UNSIGNED_SHORT,
    );
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.trailTex = trailTex;
    this.paletteTex = paletteTex;
    this.effectTex = effectTex;

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(trailFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        MAX_TRAIL_COLORS,
        ...TILE_DEFINES,
      }),
      "TrailPass",
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uTrailAlpha = gl.getUniformLocation(this.program, "uTrailAlpha")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTrailTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAffiliation"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uEffect"), 3);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }
  setAffiliationTex(tex: WebGLTexture): void {
    this.affiliationTex = tex;
  }

  // ---------------------------------------------------------------------------
  // Trail data upload
  // ---------------------------------------------------------------------------

  /** Live-game path: reference the game's own trail array directly. */
  setLiveRef(trailState: Uint16Array): void {
    this.updates.full(trailState);
  }

  applyLiveDelta(
    trailState: Uint16Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
    changedTiles?: readonly number[],
  ): void {
    if (changedTiles) this.updates.patch(trailState, changedTiles);
    else this.updates.rows(trailState, dirtyRowMin, dirtyRowMax);
  }

  flushTexture(): void {
    this.updates.flush();
  }

  /** Draw trail overlay. Blending must be enabled by caller. */
  draw(cameraMatrix: Float32Array): void {
    this.flushTexture();
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uTrailAlpha, this.settings.mapOverlay.trailAlpha);
    gl.uniform1f(this.uTime, (performance.now() - this.startTime) / 1000);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    if (this.affiliationTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.affiliationTex);
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    this.updates.dispose();
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
