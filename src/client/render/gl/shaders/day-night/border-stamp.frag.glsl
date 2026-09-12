#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;
uniform sampler2D uPalette;
uniform sampler2D uBorderTex;     // RGBA8 — border flags from BorderComputePass
uniform sampler2D uDefenseCoverageTex; // R8 — 1.0 = defended by same-owner post
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — affiliation colors (row 0 = border)
uniform vec2 uMapSize;
uniform int uAltView;
uniform float uHighlightBrighten;
uniform float uDefenseCheckerDarken;
uniform float uEmbargoTintRatio;
uniform float uFriendlyTintRatio;
uniform vec3 uEmbargoTint;
uniform vec3 uFriendlyTint;
uniform int uPoliticalStep;       // tap spacing in tiles; 0 = point sample

// #chunks

in vec2 vWorldPos;
out vec4 fragColor;

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  // Same resolve as the territory fill, so the outline belongs to the block
  // it is drawn around rather than to whichever tile the pixel centre hit.
  uint owner = uPoliticalStep > 0
    ? politicalOwner(uTileTex, tc, uPoliticalStep, ivec2(uMapSize))
    : raw & uint(OWNER_MASK);

  // Read pre-computed border flags from BorderComputePass
  vec4 borderData = texelFetch(uBorderTex, tc, 0);
  // A border is one tile wide, so below a pixel per tile the point sample
  // misses it and the map's edges simply stop being drawn. Zoomed out, take
  // the strongest border in the pixel's footprint instead — the same
  // footprint the fill uses, so the two agree — and the outline survives at
  // any zoom, which is the whole reason it is drawn.
  if (uPoliticalStep > 0) {
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        ivec2 c = clamp(tc + ivec2(dx, dy) * uPoliticalStep,
                        ivec2(0), ivec2(uMapSize) - ivec2(1));
        vec4 d = texelFetch(uBorderTex, c, 0);
        if (d.r > borderData.r) borderData = d;
      }
    }
  }
  float borderType = borderData.r;      // 0=interior, ~0.5=normal, ~1.0=highlight
  bool defense = texelFetch(uDefenseCoverageTex, tc, 0).r > 0.5; // same-owner defense post nearby
  float relation = borderData.a;        // 0.0=neutral, ~0.5=friendly, ~1.0=embargo

  bool isBorder = borderType > 0.25;
  bool isHighlightBorder = borderType > 0.75;

  // --- Border stamp: full-brightness border color ---
  if (isBorder && owner != 0u) {
    vec3 bc;
    if (uAltView != 0) {
      // Alt-view: pure affiliation color from palette row 0
      bc = texelFetch(uAffiliation, ivec2(int(owner), 0), 0).rgb;
    } else {
      float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
      bc = texture(uPalette, vec2(u, 0.75)).rgb;
      if (isHighlightBorder) {
        bc = mix(bc, vec3(1.0), uHighlightBrighten);
      }
      // Relationship tint (applied BEFORE defense checkerboard, matching game)
      if (relation > 0.75) {
        bc = mix(bc, uEmbargoTint, uEmbargoTintRatio);
      } else if (relation > 0.25) {
        bc = mix(bc, uFriendlyTint, uFriendlyTintRatio);
      }
      // Defense bonus: checkerboard darken (applied AFTER tint, matching game)
      if (defense) {
        bool checker = ((tc.x + tc.y) & 1) == 1;
        if (checker) bc *= uDefenseCheckerDarken;
      }
    }
    fragColor = vec4(bc, 1.0);
    return;
  }

  discard;
}
