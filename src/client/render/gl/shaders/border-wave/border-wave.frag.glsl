#version 300 es
precision highp float;

in vec2 vLocal;
flat in float vAlpha;

uniform vec3 uColor;
uniform float uPeak;

out vec4 fragColor;

void main() {
  // A soft disc rather than a hard dot: hundreds of these land along a moving
  // frontier in the same tick, and hard edges would read as a dotted line
  // instead of a wave.
  float d = length(vLocal);
  float mote = 1.0 - smoothstep(0.35, 1.0, d);

  float alpha = mote * vAlpha * uPeak;
  if (alpha < 0.004) discard;
  fragColor = vec4(uColor, alpha);
}
