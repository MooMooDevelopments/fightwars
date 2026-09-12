import { beforeEach, describe, expect, it, vi } from "vitest";

const howlInstances: any[] = [];

vi.mock("howler", () => {
  class MockHowl {
    src: string;
    play = vi.fn(() => 1);
    stop = vi.fn();
    unload = vi.fn();
    fade = vi.fn();
    volume = vi.fn(() => 0);
    playing = vi.fn(() => false);
    once = vi.fn();
    off = vi.fn();
    constructor(opts: any) {
      this.src = opts.src[0];
      howlInstances.push(this);
    }
  }
  return {
    Howl: MockHowl,
    Howler: { volume: vi.fn(), ctx: null, unload: vi.fn() },
  };
});

import { BRAND } from "../../../src/brand/Brand";
import {
  AudioMixer,
  resetAudioMixerForTest,
} from "../../../src/client/sound/AudioMixer";
import { startMenuMusic } from "../../../src/client/sound/MenuMusic";
import { SoundManager } from "../../../src/client/sound/SoundManager";
import { EventBus } from "../../../src/core/EventBus";
import { UserSettings } from "../../../src/core/game/UserSettings";

/**
 * The fork ships no music: upstream's gameplay loop and menu theme live in
 * /proprietary, which FightWars does not carry. Both channels must stay
 * silent without a missing-asset request or a listener waiting on nothing.
 */
describe("no music in BRAND", () => {
  let mixer: AudioMixer;

  beforeEach(() => {
    howlInstances.length = 0;
    localStorage.clear();
    resetAudioMixerForTest();
    mixer = new AudioMixer(new UserSettings());
  });

  it("is the shipped brand", () => {
    expect(BRAND.assets.gameplayMusic).toBeNull();
    expect(BRAND.assets.menuMusic).toBeNull();
  });

  it("builds no gameplay Howl and plays and stops without throwing", () => {
    const sm = new SoundManager(new EventBus(), mixer);
    expect(howlInstances.filter((h) => h.src.includes("music/"))).toEqual([]);
    expect(() => sm.playBackgroundMusic()).not.toThrow();
    expect(() => sm.stopBackgroundMusic()).not.toThrow();
    expect(() => sm.dispose()).not.toThrow();
    expect(howlInstances).toEqual([]);
  });

  it("arms no menu theme on the first gesture", () => {
    const spy = vi.spyOn(document, "addEventListener");
    startMenuMusic(mixer);
    document.dispatchEvent(new Event("pointerdown"));
    expect(howlInstances).toEqual([]);
    expect(spy).not.toHaveBeenCalledWith(
      "pointerdown",
      expect.anything(),
      expect.anything(),
    );
    spy.mockRestore();
  });
});
