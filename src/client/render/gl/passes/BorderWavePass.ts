/**
 * BorderWavePass — the light that runs along a frontier as it moves.
 *
 * Every tile that changes hands leaves a short-lived mote where it changed.
 * One mote is nothing; a few hundred of them, spawned along the edge an
 * attack is eating through, are a wave running down the border — which is the
 * point. The wave is emergent rather than authored: there is no "frontier"
 * object anywhere in the renderer, only tiles flipping, and a frontier is
 * what a lot of tiles flipping together looks like.
 *
 * Fed from the same per-tile owner-change callback the border recompute uses,
 * so it costs one array write per changed tile and no extra bookkeeping.
 *
 * **Only tiles taken from another owner count.** Expanding into unclaimed
 * land is not conquest — nobody lost anything — and counting it would set the
 * entire map alight for the first two minutes of every game, while every
 * player grows into terra nullius at once. Making the wave mean "someone lost
 * this" is what makes it worth looking at.
 *
 * The motes live in a fixed ring buffer with their birth times, and the
 * shader ages them off the clock. So a frame costs one uniform update and one
 * instanced draw however many tiles changed, and a tick costs one write per
 * tile.
 */

import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/border-wave/border-wave.frag.glsl?raw";
import vertSrc from "../shaders/border-wave/border-wave.vert.glsl?raw";

/**
 * How many motes can be alive at once.
 *
 * A large offensive flips a few hundred tiles a tick, and a mote lives about
 * four ticks, so this holds a serious battle without dropping anything. Past
 * it the oldest motes are overwritten, which is the right thing to lose.
 */
export const MOTE_CAPACITY = 4096;

/** How long a mote lives, in milliseconds. */
export const MOTE_DURATION_MS = 420;

/**
 * Mote radius in tiles, at birth and at death.
 *
 * Sized by looking. The first pair here was 0.9 to 2.1, which at a normal
 * playing zoom is a three-pixel dot with a one-pixel core, and a frontier
 * made of them reads as a dotted line rather than as a wave.
 */
const RADIUS_START_TILES = 1.3;
const RADIUS_END_TILES = 3.0;

/**
 * Fewest rendered pixels a mote may be across at its widest. Without it, a
 * war seen from the strategic zoom — the view where knowing which border is
 * moving matters most — produces motes below a pixel, which flicker rather
 * than glow.
 */
const MIN_RADIUS_PX = 1.1;

/**
 * Peak opacity of one mote.
 *
 * Also chosen by looking, against a synthetic frontier driven across a live
 * map at several settings: 0.5 is a faint bead chain, 0.85 starts to take the
 * map over, and 0.7 is a band you can read at a glance and still see the
 * territory through. The same threshold the nuke ring landed on, which is
 * probably the map's rather than the effect's.
 */
const PEAK_ALPHA = 0.7;

/**
 * A cool white, against the nuke ring's warm one. The two say different
 * things — a blast reached this far, versus this ground changed hands — and
 * should not be mistaken for each other at a glance. Neither is a hue any
 * nation can own, which is what keeps them readable over the map's own
 * saturated colours.
 */
const WAVE_COLOR: readonly [number, number, number] = [0.85, 0.92, 1.0];

const FLOATS_PER_MOTE = 3;

/**
 * Whether an owner change is a conquest — something someone lost — rather
 * than growth into empty land.
 *
 * Exported because it is the rule that decides what the wave means, and it is
 * the part of this pass that can be tested without a GL context.
 *
 * @param prevOwner owner small id before the change, 0 for unclaimed
 * @param newOwner owner small id after the change, 0 for unclaimed
 */
export function isConquest(prevOwner: number, newOwner: number): boolean {
  // Taking unclaimed land costs nobody anything, and in the first two minutes
  // of a game every player is doing it at once.
  if (prevOwner === 0) return false;
  // A tile falling out of ownership entirely — fallout clearing a nation off
  // the map — is a loss, and counts.
  return prevOwner !== newOwner;
}

/**
 * Radius the shader should use at a stated zoom, in tiles.
 *
 * @param zoom rendered pixels per tile (`Camera.zoom`)
 */
export function waveRadiusTiles(zoom: number): { start: number; end: number } {
  if (zoom <= 0) return { start: RADIUS_START_TILES, end: RADIUS_END_TILES };
  const floor = MIN_RADIUS_PX / zoom;
  return {
    start: Math.max(RADIUS_START_TILES, floor),
    end: Math.max(RADIUS_END_TILES, floor),
  };
}

export class BorderWavePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;

  private uCamera: WebGLUniformLocation;
  private uNow: WebGLUniformLocation;
  private uDuration: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uPeak: WebGLUniformLocation;

  private readonly motes = new Float32Array(MOTE_CAPACITY * FLOATS_PER_MOTE);
  private head = 0;
  private dirty = false;
  /** Wall clock of the most recent mote, so a quiet map skips the draw. */
  private newestBirthMs = -Infinity;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uNow = gl.getUniformLocation(this.program, "uNow")!;
    this.uDuration = gl.getUniformLocation(this.program, "uDuration")!;
    this.uRadius = gl.getUniformLocation(this.program, "uRadius")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uPeak = gl.getUniformLocation(this.program, "uPeak")!;

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

    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.motes.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, FLOATS_PER_MOTE * 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  /**
   * Record a tile changing hands.
   *
   * Wired to the territory pass's per-tile owner-change callback, so it is
   * called once per changed tile per tick and must stay cheap.
   *
   * @param prevOwner owner small id before the change, 0 for unclaimed
   * @param newOwner owner small id after the change, 0 for unclaimed
   */
  markTile(
    x: number,
    y: number,
    prevOwner: number,
    newOwner: number,
    nowMs: number,
  ): void {
    if (!isConquest(prevOwner, newOwner)) return;

    const off = this.head * FLOATS_PER_MOTE;
    this.motes[off + 0] = x;
    this.motes[off + 1] = y;
    this.motes[off + 2] = nowMs / 1000;
    this.head = (this.head + 1) % MOTE_CAPACITY;
    this.dirty = true;
    if (nowMs > this.newestBirthMs) this.newestBirthMs = nowMs;
  }

  /**
   * Draw every live mote. Blending must be enabled.
   *
   * @param zoom rendered pixels per tile (`Camera.zoom`)
   */
  draw(cameraMatrix: Float32Array, zoom: number, nowMs: number): void {
    // Nothing has changed hands recently enough to still be alight.
    if (nowMs - this.newestBirthMs >= MOTE_DURATION_MS) return;

    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.dirty) {
      // The whole buffer, rather than tracking which slots moved: at 48 KB
      // this is cheaper than the bookkeeping, and the ring wraps often enough
      // during a battle that a range upload would usually be two calls.
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.motes);
      this.dirty = false;
    }

    const radius = waveRadiusTiles(zoom);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uNow, nowMs / 1000);
    gl.uniform1f(this.uDuration, MOTE_DURATION_MS / 1000);
    gl.uniform2f(this.uRadius, radius.start, radius.end);
    gl.uniform3f(this.uColor, WAVE_COLOR[0], WAVE_COLOR[1], WAVE_COLOR[2]);
    gl.uniform1f(this.uPeak, PEAK_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, MOTE_CAPACITY);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteVertexArray(this.vao);
  }
}
