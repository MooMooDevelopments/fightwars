/**
 * FlashPass — the white-out a detonation leaves on the view.
 *
 * A full-screen wash, drawn last of the world passes. It lives in GL rather
 * than as a DOM overlay for one reason: the HUD is DOM and sits above the
 * canvas, so a GL flash covers the map and leaves the player's readouts
 * legible, which is the behaviour you want at exactly the moment something
 * has gone off.
 *
 * Holds its own intensity and decays it by wall-clock time, so the fade is
 * the same length on any frame rate.
 */

import { createFullscreenQuad, createProgram } from "../utils/GlUtils";

import flashFragSrc from "../shaders/shared/flash.frag.glsl?raw";
import fullscreenNoUvVertSrc from "../shaders/shared/fullscreen-no-uv.vert.glsl?raw";

/**
 * How long the wash takes to clear. Short: a flash that outstays its welcome
 * reads as a bug, and the player has a war to watch.
 */
export const FLASH_DURATION_MS = 320;

/**
 * Ceiling on how much of the screen a flash may take, whatever asks for it.
 * A full white-out hides the map completely; at this the detonation is
 * unmistakable and the map is still readable through it.
 */
export const MAX_FLASH_INTENSITY = 0.55;

/**
 * Opacity at `elapsedMs` into a flash of peak `strength`.
 *
 * Cubic falloff: the first moment is nearly the whole flash and the tail is
 * gone quickly, which is how a bright event actually leaves the eye. A linear
 * fade reads as a slow curtain.
 */
export function flashIntensity(elapsedMs: number, strength: number): number {
  if (strength <= 0 || elapsedMs < 0 || elapsedMs >= FLASH_DURATION_MS) {
    return 0;
  }
  const remaining = 1 - elapsedMs / FLASH_DURATION_MS;
  const peak = Math.min(strength, MAX_FLASH_INTENSITY);
  return peak * remaining * remaining * remaining;
}

export class FlashPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uColor: WebGLUniformLocation;
  private uIntensity: WebGLUniformLocation;

  private strength = 0;
  private startedAtMs = 0;
  private color: [number, number, number] = [1, 1, 1];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, fullscreenNoUvVertSrc, flashFragSrc);
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uIntensity = gl.getUniformLocation(this.program, "uIntensity")!;
    this.vao = createFullscreenQuad(gl);
  }

  /**
   * Start a flash, unless a stronger one is still running — two warheads a
   * frame apart are one event to the eye, and adding them would white the
   * screen out entirely during a MIRV.
   *
   * @param strength peak opacity, clamped by MAX_FLASH_INTENSITY
   */
  trigger(
    strength: number,
    nowMs: number,
    color: [number, number, number] = [1, 1, 1],
  ): void {
    if (strength <= 0) return;
    if (flashIntensity(nowMs - this.startedAtMs, this.strength) >= strength) {
      return;
    }
    this.strength = strength;
    this.startedAtMs = nowMs;
    this.color = color;
  }

  /** Draw the wash. Blending must be enabled; a spent flash draws nothing. */
  draw(nowMs: number): void {
    const intensity = flashIntensity(nowMs - this.startedAtMs, this.strength);
    if (intensity <= 0) return;

    const gl = this.gl;
    // Set the blend explicitly rather than inheriting whatever the previous
    // overlay left bound: the wash has to be a straight alpha mix toward the
    // flash colour, and under an additive blend it would clip to white over
    // bright terrain while barely showing over dark ocean.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniform3f(this.uColor, this.color[0], this.color[1], this.color[2]);
    gl.uniform1f(this.uIntensity, intensity);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }
}
