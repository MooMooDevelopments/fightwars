/**
 * FightWars brand configuration.
 *
 * Every brand-facing string, asset path, URL and monetisation switch lives
 * here and nowhere else. Client, server and build code import from this
 * module; nothing hardcodes a product name, logo path or community link.
 * That is what keeps upstream rebases painless: the diff against OpenFront
 * is "read BRAND.x" instead of a scattered find-and-replace.
 *
 * This module has no imports and no runtime dependencies so it can be used
 * from the Vite config, the Node server and the browser bundle alike.
 *
 * Licence note: FightWars is a fork of OpenFront (AGPL-3.0). OpenFront's
 * LICENSE carries AGPL §7 additional terms: the notice in
 * `BRAND.upstream.copyright` must stay visible in the footer and on the
 * loading screen, and "OpenFront" must not be used as our primary title.
 * `BRAND.upstream` exists so those obligations are met from one place.
 */

export const BRAND = {
  /** Product name as shown in UI, page titles and the PWA manifest. */
  name: "FightWars",
  /** Short form for tight spaces (mobile nav, PWA short_name). */
  shortName: "FightWars",
  /** Browser <title>. */
  title: "FightWars",
  tagline: "Real-time territorial conquest.",
  /** og:description / manifest description. */
  description:
    "FightWars is a real-time multiplayer strategy game: spawn, expand, " +
    "forge alliances and take the map before it takes you.",
  /**
   * Canonical site origin (no trailing slash). Empty until a production
   * domain exists; consumers must omit canonical/og:url tags when empty.
   */
  siteUrl: "",
  /** The public source repository — linked from the About panel (AGPL §13). */
  repoUrl: "https://github.com/MooMooDevelopments/fightwars",
  /** Shown only when non-empty. */
  supportEmail: "",
  /**
   * Embedded "how to play" video, rendered only when non-empty. Empty until
   * FightWars has one of its own: the inherited value pointed at a
   * third-party OpenFront tutorial, which showed someone else's product (and
   * someone else's UI) inside our death and victory screens.
   */
  tutorialVideoUrl: "",
  /** Community links; each is rendered only when non-empty. */
  community: {
    discordUrl: "",
    redditUrl: "",
    wikiUrl: "",
  },
  /**
   * Identity providers this deployment can actually sign a player in with.
   *
   * All false in FightWars: the API has no `/auth/login/*` routes, so the
   * inherited Discord, Google and Steam buttons sent every player to a 404,
   * and the magic-link form had nothing to post to. Turning one on means
   * building its route first — the account page reads this and renders only
   * what is here.
   *
   * Nothing is lost by having none: a session *is* an account here, so a
   * player already has one. See the guest panel in AccountModal.
   */
  identity: {
    discord: false,
    google: false,
    steam: false,
    email: false,
  },
  /** Desktop (Steam/Electron shell) identifiers. */
  desktop: {
    /** Custom URL scheme the desktop shell serves the app from. */
    scheme: "app://fightwars",
    /** Name of the bridge object the shell injects on `window`. */
    windowObject: "fightwarsDesktop",
  },
  /** Observability identifiers. */
  telemetry: {
    serviceName: "fightwars",
    /** Prefix for custom OpenTelemetry attribute and metric names. */
    attributePrefix: "fightwars",
  },
  /** Asset paths, relative to the resources root (served via assetUrl()). */
  assets: {
    logo: "images/FightWarsLogo.svg",
    logoDark: "images/FightWarsLogoDark.svg",
    /**
     * Logo for the server-rendered index (desktop width). An SVG works in
     * <img>; a raster is not required.
     */
    logoPng: "images/FightWarsLogo.svg",
    /** Compact mark for the server-rendered index (mobile width). */
    iconPng: "images/Favicon.svg",
    favicon: "images/Favicon.svg",
    /** Social-card image. */
    socialImage: "images/SocialCard.png",
    /**
     * Display face: the wordmark, headings, the version label and every
     * number in the HUD. Condensed on purpose — a territorial game is read
     * as a column of figures (troops, gold, tiles, percentages) and a
     * condensed face fits more of them at a legible size.
     */
    displayFontFamily: "Barlow Condensed",
    /** Font file registered under displayFontFamily via FontFace. */
    displayFontFile: "fonts/barlow-condensed-latin-600-normal.woff2",
    /** Body face: everything that is prose rather than a figure. */
    bodyFontFamily: "Barlow",
    /**
     * Every face the client registers at boot, display and body alike.
     * `npm run fonts:sync` is what puts these files in resources/fonts.
     */
    fontFaces: [
      {
        family: "Barlow Condensed",
        weight: "600",
        file: "fonts/barlow-condensed-latin-600-normal.woff2",
      },
      {
        family: "Barlow",
        weight: "400",
        file: "fonts/barlow-latin-400-normal.woff2",
      },
      {
        family: "Barlow",
        weight: "600",
        file: "fonts/barlow-latin-600-normal.woff2",
      },
    ] as readonly { family: string; weight: string; file: string }[],
    /**
     * The looping in-game track (SoundManager) and the home-page theme
     * (MenuMusic). Upstream ships both under /proprietary, which this fork
     * does not carry; null means that channel stays silent.
     */
    gameplayMusic: null as string | null,
    menuMusic: null as string | null,
    /** Played when a lobby the player is waiting in starts. */
    gameStartAlert: "sounds/effects/game-start-alert.wav",
  },
  /** The project this is a fork of, and the attribution it requires. */
  upstream: {
    name: "OpenFront",
    url: "https://github.com/openfrontio/OpenFrontIO",
    siteUrl: "https://openfront.io",
    /** AGPL §7(b): must stay visible in the footer and on the loading screen. */
    copyright: "© OpenFront and Contributors",
    /** Title-screen attribution required by the FightWars brief. */
    basedOn: "Based on OpenFront",
  },
  /**
   * Monetisation switches. FightWars ships with none of these on: no ads,
   * no ad-block gate, no store, no Steam wishlist prompts. Code paths that
   * exist upstream stay in the tree but render nothing when off.
   */
  monetisation: {
    ads: false,
    store: false,
    steam: false,
  },
} as const;

export type Brand = typeof BRAND;
