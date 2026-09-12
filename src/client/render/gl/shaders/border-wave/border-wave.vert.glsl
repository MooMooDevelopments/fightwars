#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-mote: tile x, tile y, birth time in seconds
layout(location = 1) in vec3 aMote;

uniform mat3 uCamera;
uniform float uNow;       // seconds, same clock as aMote.z
uniform float uDuration;  // seconds a mote lives
uniform vec2 uRadius;     // (at birth, at death), in tiles

out vec2 vLocal;
flat out float vAlpha;

void main() {
  float age = uNow - aMote.z;
  float t = age / uDuration;
  // Dead and unborn motes are pushed outside the clip volume rather than
  // drawn transparent: the buffer is a fixed ring and most of it is dead most
  // of the time, so this is the fragment work that never happens.
  if (age < 0.0 || t >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vLocal = aPos * 2.0 - 1.0;
  // Brightest at the moment the tile changes hands, then out. Slightly faster
  // than linear at the end so a frontier that has stopped moving goes dark
  // rather than lingering as a smear.
  vAlpha = pow(1.0 - t, 1.2);

  float radius = mix(uRadius.x, uRadius.y, t);
  vec2 centre = aMote.xy + 0.5;
  vec2 worldPos = centre + vLocal * radius;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
