#version 300 es
precision highp float;

in vec2 vLocal;
flat in float vExtent;
flat in float vRadius;
flat in float vStroke;
flat in float vAlpha;

uniform vec3 uColor;
// Tiles per rendered pixel — the width the ring's edge is softened over, so
// the falloff is one pixel wide at any zoom rather than one tile wide.
uniform float uTilesPerPixel;

out vec4 fragColor;

void main() {
  float dist = length(vLocal) * vExtent;

  // Distance from the ring itself, so the stroke is symmetric about it and a
  // ring that has only just started still draws as a ring rather than a disc.
  float offset = abs(dist - vRadius);

  // Softened by a pixel on each side. Without the pixel term the edge would
  // stair-step when a tile is many pixels across and shimmer when it is less
  // than one.
  float edge = max(uTilesPerPixel, 0.001);
  float ring = 1.0 - smoothstep(vStroke - edge, vStroke + edge, offset);

  float alpha = ring * vAlpha;
  if (alpha < 0.004) discard;
  fragColor = vec4(uColor, alpha);
}
