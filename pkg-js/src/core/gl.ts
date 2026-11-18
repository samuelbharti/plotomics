/**
 * Free a regl instance and its WebGL context at once.
 *
 * `regl.destroy()` frees the buffers and textures but leaves the context alive
 * until garbage collection. Browsers keep only a few live contexts per page
 * (Chrome drops the oldest after about 16), so a component built again and
 * again, as the R and Python bindings do when an option is cleared, would
 * otherwise make another plot on the page go blank. `WEBGL_lose_context`
 * releases the context now.
 */
export function releaseRegl(
  regl: { _gl?: WebGLRenderingContext; destroy(): void } | null | undefined,
): void {
  if (!regl) return;
  const gl = regl._gl;
  regl.destroy();
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
}
