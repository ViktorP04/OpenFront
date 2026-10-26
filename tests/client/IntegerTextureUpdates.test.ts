import { beforeEach, expect, it, vi } from "vitest";

const scatter = vi.hoisted(() => ({
  push: vi.fn(),
  flush: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../../src/client/render/gl/passes/TileScatterPass", () => ({
  TileScatterPass: class {
    push = scatter.push;
    flush = scatter.flush;
    dispose = scatter.dispose;
  },
}));
import { IntegerTextureUpdates } from "../../src/client/render/gl/passes/IntegerTextureUpdates";

function setup() {
  const gl = {
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texSubImage2D: vi.fn(),
    TEXTURE0: 0,
    TEXTURE_2D: 1,
    RED_INTEGER: 2,
    UNSIGNED_SHORT: 3,
  };
  const source = new Uint16Array(10000);
  const updates = new IntegerTextureUpdates(
    gl as unknown as WebGL2RenderingContext,
    100,
    100,
    {} as WebGLTexture,
    gl.UNSIGNED_SHORT,
  );
  return { gl, source, updates };
}
beforeEach(() => vi.clearAllMocks());

it("scatters only changed pixels and reads the latest values at render time", () => {
  const { gl, source, updates } = setup();
  source[9999] = 8;
  updates.patch(source, [9999, 3]);
  source[9999] = 0;
  source[3] = 77;
  updates.patch(source, [9999]);
  updates.flush();
  expect(scatter.push.mock.calls).toEqual([
    [99, 99, 0],
    [3, 0, 77],
  ]);
  expect(scatter.flush).toHaveBeenCalledOnce();
  expect(gl.texSubImage2D).not.toHaveBeenCalled();
  updates.flush();
  expect(scatter.flush).toHaveBeenCalledOnce();
});

it("lets full uploads supersede earlier patches and include subsequent changes", () => {
  const { gl, source, updates } = setup();
  updates.patch(source, [42]);
  updates.full(source);
  source[12] = 99;
  updates.patch(source, [12]);
  updates.flush();
  expect(scatter.push).not.toHaveBeenCalled();
  expect(gl.texSubImage2D).toHaveBeenCalledOnce();
  expect(gl.texSubImage2D.mock.calls[0].slice(-1)[0]).toBe(source);
  expect(source[12]).toBe(99);
});

it("supports legacy row uploads alongside sparse updates", () => {
  const { gl, source, updates } = setup();
  updates.rows(source, 10, 12);
  updates.patch(source, [9999]);
  updates.flush();
  expect(gl.texSubImage2D.mock.calls[0].slice(2, 6)).toEqual([0, 10, 100, 3]);
  expect(gl.texSubImage2D.mock.calls[0].slice(-1)[0]).toHaveLength(300);
  expect(scatter.push).toHaveBeenCalledWith(99, 99, 0);
});

it("uses one full upload for dense changes and skips empty updates", () => {
  const { gl, source, updates } = setup();
  updates.patch(source, []);
  updates.flush();
  expect(gl.texSubImage2D).not.toHaveBeenCalled();
  updates.patch(
    source,
    Array.from({ length: 2000 }, (_, i) => i),
  );
  updates.flush();
  expect(gl.texSubImage2D).toHaveBeenCalledOnce();
  expect(scatter.push).not.toHaveBeenCalled();
  updates.dispose();
  expect(scatter.dispose).toHaveBeenCalledOnce();
});
