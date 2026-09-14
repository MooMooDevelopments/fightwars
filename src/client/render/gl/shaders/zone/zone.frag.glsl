#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1]

uniform float uRadius;
uniform int uKind;   // 0 Battle Royale ring, 1 the hill
uniform float uTime; // seconds

out vec4 fragColor;

void main() {
  float dist = length(vLocal) * (uRadius + 3.0);
  float edge = uRadius;

  if (uKind == 0) {
    // Battle Royale: a two-tile rim at the edge, warm like the fallout it
    // leaves, breathing slowly; a faint haze just outside so the direction
    // of loss reads even where the ground is not yet irradiated.
    float rim = smoothstep(edge - 2.0, edge - 1.0, dist)
              * (1.0 - smoothstep(edge, edge + 1.0, dist));
    float haze = smoothstep(edge, edge + 0.5, dist)
               * (1.0 - smoothstep(edge + 2.0, edge + 3.0, dist));
    float breath = 0.75 + 0.25 * sin(uTime * 1.6);
    float alpha = rim * 0.7 * breath + haze * 0.18;
    if (alpha < 0.002) discard;
    fragColor = vec4(1.0, 0.55, 0.2, alpha);
  } else {
    // The hill: a gold disc at low alpha with a firm one-tile rim.
    float fill = 1.0 - smoothstep(edge - 0.5, edge + 0.5, dist);
    float rim = smoothstep(edge - 1.5, edge - 0.5, dist)
              * (1.0 - smoothstep(edge, edge + 0.5, dist));
    float alpha = fill * 0.14 + rim * 0.6;
    if (alpha < 0.002) discard;
    fragColor = vec4(1.0, 0.84, 0.3, alpha);
  }
}
