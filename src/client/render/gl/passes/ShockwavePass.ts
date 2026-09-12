/**
 * ShockwavePass — the ring a detonation throws out across the map.
 *
 * The flash and the shake say *something went off near you*; they are a
 * property of where the camera is pointing and they fade in a third of a
 * second. The ring says *this is how far it reached*, and that is map
 * information: it is drawn in world space, on the ground, at the blast's own
 * radius, and it is deliberately not scaled by how close the player was
 * looking. A player watching someone else's war from across the map still
 * wants to know what a hydrogen bomb covers.
 *
 * Timing lives in the exported pure functions rather than in the shader, so
 * the curve can be tested without a GL context — the only part of the
 * renderer that can be. At most MAX_RINGS instances are ever in flight, so
 * recomputing them per frame on the CPU costs nothing worth measuring.
 */

import { DynamicInstanceBuffer } from "../DynamicBuffer";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/shockwave/shockwave.frag.glsl?raw";
import vertSrc from "../shaders/shockwave/shockwave.vert.glsl?raw";

/**
 * Ceiling on rings alive at once. A MIRV lands about thirty warheads over a
 * few seconds; past that the screen is rings rather than map, and the oldest
 * ones are the least informative.
 */
export const MAX_RINGS = 24;

/**
 * How long a ring of `maxRadius` tiles takes to reach it.
 *
 * Sub-linear in the radius: a hydrogen bomb covers three times the ground of
 * an atom bomb but must not take three times as long to say so, or the ring
 * is still crawling outward when the player has moved on. The constant term
 * is what keeps a MIRV warhead's small ring on screen long enough to be seen
 * at all.
 */
export function shockwaveDurationMs(maxRadius: number): number {
  return 380 + 5.2 * Math.max(0, maxRadius);
}

/**
 * Ring radius at `elapsedMs`, in tiles.
 *
 * Decelerating: a real blast front loses speed against the air, and visually
 * the fast opening is what reads as force. A linear expansion reads as an
 * animation playing rather than something happening.
 */
export function shockwaveRadius(elapsedMs: number, maxRadius: number): number {
  const duration = shockwaveDurationMs(maxRadius);
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= duration) return maxRadius;
  const t = elapsedMs / duration;
  const remaining = 1 - t;
  return maxRadius * (1 - remaining * remaining);
}

/**
 * Falloff exponent for the fade.
 *
 * Chosen by looking, not by taste: the first curve here was `remaining^1.5`,
 * which sounded right — brightest while it is still moving fast — and put the
 * ring at 0.24 opacity a third of the way through its life, where it is
 * invisible on a live map. Screenshots over terrain put the threshold for a
 * warm-white line at about 0.5, and 0.6 is where it reads without taking the
 * map over. Below 1 the ring holds most of its opacity through the expansion
 * and then goes, instead of being brightest when it is too small to see.
 */
const FADE_EXPONENT = 0.8;

/**
 * Ring opacity at `elapsedMs`, for a ring started at peak `strength`.
 *
 * Still fades throughout, so the arrival at full radius is not the thing the
 * eye notices; it just stays legible on the way there.
 */
export function shockwaveAlpha(
  elapsedMs: number,
  maxRadius: number,
  strength: number,
): number {
  const duration = shockwaveDurationMs(maxRadius);
  if (strength <= 0 || elapsedMs < 0 || elapsedMs >= duration) return 0;
  const remaining = 1 - elapsedMs / duration;
  return strength * Math.pow(remaining, FADE_EXPONENT);
}

/** Stroke half-width in tiles, at a stated zoom. */
const STROKE_TILES = 1.2;

/**
 * Fewest rendered pixels the stroke may be half-wide. Item 3's lesson applied
 * to a moving line: a world-space stroke below a pixel does not thin, it
 * flickers in and out as the ring crosses pixel centres.
 */
const MIN_STROKE_PX = 0.9;

/**
 * @param zoom rendered pixels per tile (`Camera.zoom`)
 */
export function shockwaveStrokeTiles(zoom: number): number {
  if (zoom <= 0) return STROKE_TILES;
  return Math.max(STROKE_TILES, MIN_STROKE_PX / zoom);
}

/** A warm white: the front is lit by the fireball behind it, not by daylight. */
const RING_COLOR: readonly [number, number, number] = [1.0, 0.93, 0.8];

interface Ring {
  x: number;
  y: number;
  maxRadius: number;
  strength: number;
  startedAtMs: number;
}

// Per-instance: x, y, radius, stroke, alpha
const FLOATS_PER_INSTANCE = 5;

export class ShockwavePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;

  private uCamera: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uTilesPerPixel: WebGLUniformLocation;

  private rings: Ring[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uTilesPerPixel = gl.getUniformLocation(
      this.program,
      "uTilesPerPixel",
    )!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      MAX_RINGS,
      FLOATS_PER_INSTANCE,
    );
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  /**
   * Start a ring at a tile.
   *
   * Unlike the flash, overlapping rings are kept rather than merged: two
   * warheads a second apart threw out two fronts and the player should see
   * both. Only the pool ceiling merges anything, and it drops the oldest.
   *
   * @param strength peak opacity
   * @param maxRadius the blast's outer radius in tiles
   */
  trigger(
    x: number,
    y: number,
    maxRadius: number,
    strength: number,
    nowMs: number,
  ): void {
    if (strength <= 0 || maxRadius <= 0) return;
    if (this.rings.length >= MAX_RINGS) {
      let oldest = 0;
      for (let i = 1; i < this.rings.length; i++) {
        if (this.rings[i].startedAtMs < this.rings[oldest].startedAtMs) {
          oldest = i;
        }
      }
      this.rings.splice(oldest, 1);
    }
    this.rings.push({ x, y, maxRadius, strength, startedAtMs: nowMs });
  }

  /**
   * Draw every live ring, dropping those that have expired. Blending must be
   * enabled.
   *
   * @param zoom rendered pixels per tile (`Camera.zoom`)
   */
  draw(cameraMatrix: Float32Array, zoom: number, nowMs: number): void {
    if (this.rings.length === 0) return;

    const stroke = shockwaveStrokeTiles(zoom);
    const buf = this.instanceBuf.float32;
    let count = 0;
    let live = 0;

    for (const ring of this.rings) {
      const elapsed = nowMs - ring.startedAtMs;
      const alpha = shockwaveAlpha(elapsed, ring.maxRadius, ring.strength);
      if (alpha <= 0) {
        // A ring whose time has not started yet (a clock that went backwards)
        // is kept; one that has run out is dropped.
        if (elapsed < 0) this.rings[live++] = ring;
        continue;
      }
      this.rings[live++] = ring;
      const off = count * FLOATS_PER_INSTANCE;
      buf[off + 0] = ring.x;
      buf[off + 1] = ring.y;
      buf[off + 2] = shockwaveRadius(elapsed, ring.maxRadius);
      buf[off + 3] = stroke;
      buf[off + 4] = alpha;
      count++;
    }
    this.rings.length = live;
    if (count === 0) return;

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf, 0, count * FLOATS_PER_INSTANCE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform3f(this.uColor, RING_COLOR[0], RING_COLOR[1], RING_COLOR[2]);
    gl.uniform1f(this.uTilesPerPixel, zoom > 0 ? 1 / zoom : 1);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
