#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance: centre x, centre y, ring radius, stroke half-width (tiles)
layout(location = 1) in vec4 aRing;
// Per-instance: opacity
layout(location = 2) in float aAlpha;

uniform mat3 uCamera;

out vec2 vLocal;        // [-1, +1] within the quad
flat out float vExtent; // half-width of the quad in tiles
flat out float vRadius;
flat out float vStroke;
flat out float vAlpha;

void main() {
  vLocal = aPos * 2.0 - 1.0;
  vRadius = aRing.z;
  vStroke = aRing.w;
  vAlpha = aAlpha;

  // The quad has to cover the ring plus its stroke plus the pixel the edge is
  // antialiased over; a tighter fit clips the outside of the stroke when the
  // ring is near its full radius.
  vExtent = aRing.z + aRing.w + 1.0;
  vec2 centre = aRing.xy + 0.5;
  vec2 worldPos = centre + vLocal * vExtent;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
