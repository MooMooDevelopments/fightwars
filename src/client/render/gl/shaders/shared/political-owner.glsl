// Which owner a pixel should show when one pixel covers several tiles.
//
// Nine taps spread over the pixel's own footprint, and the owner holding most
// of it wins. A point sample of a fragmented frontier shimmers as the camera
// moves and scatters a large holding into speckle; the majority of the
// footprint does neither.
//
// Unowned never wins a footprint that contains any territory at all. That
// dilates a thin holding up to a whole pixel, which is the point: below a
// pixel per tile a small player would otherwise vanish from the map entirely,
// and a player still on it is the truer picture.
//
// `step` is the spacing in tiles between taps; the caller passes 0 when a tile
// is at least a pixel across, and then this is never reached.
uint politicalOwner(in usampler2D tileTex, ivec2 tc, int step, ivec2 mapSize) {
  uint samples[9];
  int n = 0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 c = clamp(tc + ivec2(dx, dy) * step, ivec2(0), mapSize - ivec2(1));
      samples[n++] = texelFetch(tileTex, c, 0).r & uint(OWNER_MASK);
    }
  }

  // Ties go to whichever owner the fixed scan order reaches first, so the
  // same footprint always resolves the same way and a still camera is still.
  uint best = 0u;
  int bestCount = 0;
  for (int i = 0; i < 9; i++) {
    if (samples[i] == 0u) continue;
    int count = 0;
    for (int j = 0; j < 9; j++) {
      if (samples[j] == samples[i]) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = samples[i];
    }
  }
  return best;
}
