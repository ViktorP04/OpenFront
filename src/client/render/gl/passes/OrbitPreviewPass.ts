import { satelliteOrbitSegments } from "@openfront/engine-lib/game/SatelliteOrbit";
import type { GhostPreviewData } from "../../types";
import { createProgram } from "../utils/GlUtils";

/** Cyan orbit segments and arrowheads, split at map seams. */
export class OrbitPreviewPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private camera: WebGLUniformLocation;
  private count = 0;
  constructor(private gl: WebGL2RenderingContext) {
    this.program = createProgram(
      gl,
      `#version 300 es
      precision highp float; layout(location=0) in vec2 aPos; uniform mat3 uCamera;
      void main(){gl_Position=vec4((uCamera*vec3(aPos,1.0)).xy,0.0,1.0);}`,
      `#version 300 es
      precision highp float; out vec4 outColor; void main(){outColor=vec4(0.2,0.9,1.0,0.85);}`,
      "OrbitPreviewPass",
    );
    this.camera = gl.getUniformLocation(this.program, "uCamera")!;
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
  updateGhostPreview(data: GhostPreviewData | null): void {
    this.count = 0;
    if (!data?.orbit) return;
    const { width, height, sourceX, sourceY } = data.orbit;
    const vertices: number[] = [];
    for (const [x, y, nx, ny] of satelliteOrbitSegments(
      width,
      height,
      sourceX,
      sourceY,
      data.tileX,
      data.tileY,
    )) {
      const length = Math.hypot(nx - x, ny - y);
      if (length < 0.001) continue;
      const ux = (nx - x) / length,
        uy = (ny - y) / length;
      const px = -uy * 0.8,
        py = ux * 0.8;
      vertices.push(
        x + px,
        y + py,
        x - px,
        y - py,
        nx + px,
        ny + py,
        nx + px,
        ny + py,
        x - px,
        y - py,
        nx - px,
        ny - py,
      );
      const mx = (x + nx) / 2,
        my = (y + ny) / 2;
      vertices.push(
        mx + ux * 6,
        my + uy * 6,
        mx - ux * 3 - uy * 3,
        my - uy * 3 + ux * 3,
        mx - ux * 3 + uy * 3,
        my - uy * 3 - ux * 3,
      );
    }
    this.count = vertices.length / 2;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array(vertices),
      this.gl.DYNAMIC_DRAW,
    );
  }
  draw(camera: Float32Array): void {
    if (!this.count) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.camera, false, camera);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
  dispose(): void {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
