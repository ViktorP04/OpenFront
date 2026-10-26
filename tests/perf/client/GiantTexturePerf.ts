import { IntegerTextureUpdates } from "../../../src/client/render/gl/passes/IntegerTextureUpdates";

// Through Vite, run: await import("/tests/perf/client/GiantTexturePerf.ts")
// Real shaders/textures; timings include gl.finish(), not game frame rate.
const width = 4108,
  height = 1948;
const canvas = document.createElement("canvas");
const result = document.createElement("pre");
document.body.appendChild(result);
try {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 unavailable");
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = debug
    ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  const refs = [0, width - 1, width * 500 + 1500, width * height - 1];
  const formats = [];
  for (const bytes of [1, 2]) {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      1,
      bytes === 1 ? gl.R8UI : gl.R16UI,
      width,
      height,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const source =
      bytes === 1
        ? new Uint8Array(width * height)
        : new Uint16Array(width * height);
    const updates = new IntegerTextureUpdates(
      gl,
      width,
      height,
      texture,
      bytes === 1 ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT,
    );
    updates.full(source);
    updates.flush();
    gl.finish();
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("Integer framebuffer incomplete");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const timings: Record<string, number> = {};
    for (const mode of ["full", "sparse"]) {
      const start = performance.now();
      for (let i = 0; i < 30; i++) {
        for (const ref of refs) source[ref] = i + 1;
        if (mode === "full") updates.full(source);
        else updates.patch(source, refs);
        updates.flush();
        gl.finish();
      }
      timings[mode] = (performance.now() - start) / 30;
    }
    // A reveal followed by a hide before the next render must upload the hide.
    source[refs[0]] = 99;
    updates.patch(source, [refs[0]]);
    source[refs[0]] = 0;
    updates.patch(source, [refs[0]]);
    updates.flush();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (const ref of [...refs, width * 600 + 2000]) {
      const pixel = new Uint32Array(4);
      gl.readPixels(
        ref % width,
        Math.floor(ref / width),
        1,
        1,
        gl.RGBA_INTEGER,
        gl.UNSIGNED_INT,
        pixel,
      );
      if (pixel[0] !== source[ref])
        throw new Error(
          `Readback mismatch at ${ref}: ${pixel[0]} != ${source[ref]}`,
        );
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
    formats.push({
      bytes,
      msPerUpdate: timings,
      fullBytes: source.byteLength,
      sparseBytes: refs.length * 12,
      readback: "passed",
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    updates.dispose();
    gl.deleteTexture(texture);
  }
  const output = { renderer, width, height, formats };
  Object.assign(window, { giantTextureResult: output });
  result.textContent = JSON.stringify(output, null, 2);
} catch (error) {
  const output = { error: String(error) };
  Object.assign(window, { giantTextureResult: output });
  result.textContent = JSON.stringify(output);
}
