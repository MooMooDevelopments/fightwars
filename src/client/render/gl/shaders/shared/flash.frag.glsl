#version 300 es
precision highp float;

uniform vec3 uColor;
uniform float uIntensity;   // 0 = nothing to draw

out vec4 fragColor;

void main() {
  // Premultiplied against a straight alpha blend: the flash washes the scene
  // toward its colour rather than adding to it, so a detonation over bright
  // terrain blows out the same way it does over dark ocean instead of
  // clipping on one and barely showing on the other.
  fragColor = vec4(uColor, uIntensity);
}
