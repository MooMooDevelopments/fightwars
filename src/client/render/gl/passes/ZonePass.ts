/**
 * ZonePass — draws a mode's zone on the map (brief §6.7): Battle Royale's
 * playable circle as a ring the land outside is lost past, and King of the
 * Hill's hill as a filled disc with a rim. One quad per zone, a circle SDF
 * in the fragment shader, like the range circle it sits under. The Battle
 * Royale ring breathes slowly so a still map still reads as a closing one.
 */

import type { ZoneData } from "../../types";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/zone/zone.frag.glsl?raw";
import vertSrc from "../shaders/zone/zone.vert.glsl?raw";

export class ZonePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private uCamera: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;
  private uKind: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;

  private zones: readonly ZoneData[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uRadius = gl.getUniformLocation(this.program, "uRadius")!;
    this.uKind = gl.getUniformLocation(this.program, "uKind")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;

    // Unit quad [0,1]
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
    gl.bindVertexArray(null);
  }

  update(zones: readonly ZoneData[]): void {
    this.zones = zones;
  }

  draw(cameraMatrix: Float32Array, nowMs: number): void {
    if (this.zones.length === 0) return;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uTime, (nowMs % 100000) / 1000);

    for (const zone of this.zones) {
      if (zone.radius <= 0) continue;
      gl.uniform2f(this.uCenter, zone.x, zone.y);
      gl.uniform1f(this.uRadius, zone.radius);
      gl.uniform1i(this.uKind, zone.kind);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }
}
