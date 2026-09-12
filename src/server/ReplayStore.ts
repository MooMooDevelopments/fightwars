/**
 * Replay storage (FightWars, Section 8 of the brief).
 *
 * Upstream archives every finished game by POSTing the record to its
 * closed-source API and reads it back from there; without that API there
 * is no replay at all. FightWars keeps the record itself:
 *
 *   FileReplayStore  — one gzip-compressed JSON per game under REPLAY_DIR
 *                      (`<gameID>.json.gz`, a few KB: map id, seed/config,
 *                      players and the ordered intent log). The default in
 *                      dev and whenever REPLAY_DIR is set.
 *   ApiReplayStore   — upstream's behaviour, kept for deployments that still
 *                      run an OpenFront-compatible API.
 *
 * A Postgres-backed store slots in behind the same interface later.
 */
import fs from "fs";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import { GameID, GameRecord, GameRecordSchema, ID } from "../core/Schemas";
import { replacer } from "../core/Util";
import { GameEnv } from "../core/configuration/Config";
import { ServerEnv } from "./ServerEnv";

export interface ReplayStore {
  readonly kind: "file" | "api";
  save(record: GameRecord): Promise<void>;
  load(gameID: GameID): Promise<GameRecord | null>;
}

export class FileReplayStore implements ReplayStore {
  readonly kind = "file" as const;

  constructor(readonly dir: string) {}

  private file(gameID: GameID): string {
    if (!ID.safeParse(gameID).success) {
      throw new Error(`invalid game id: ${gameID}`);
    }
    return path.join(this.dir, `${gameID}.json.gz`);
  }

  async save(record: GameRecord): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const target = this.file(record.info.gameID);
    const tmp = `${target}.${process.pid}.tmp`;
    const bytes = gzipSync(Buffer.from(JSON.stringify(record, replacer)));
    await fs.promises.writeFile(tmp, bytes);
    await fs.promises.rename(tmp, target);
  }

  async load(gameID: GameID): Promise<GameRecord | null> {
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(this.file(gameID));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const json = JSON.parse(gunzipSync(bytes).toString("utf8"));
    return GameRecordSchema.parse(json);
  }
}

export class ApiReplayStore implements ReplayStore {
  readonly kind = "api" as const;

  private url(gameID: GameID): string {
    return `${ServerEnv.jwtIssuer()}/game/${gameID}`;
  }

  async save(record: GameRecord): Promise<void> {
    const response = await fetch(this.url(record.info.gameID), {
      method: "POST",
      body: JSON.stringify(record, replacer),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (!response.ok) {
      throw new Error(`archive API ${response.status} ${response.statusText}`);
    }
  }

  async load(gameID: GameID): Promise<GameRecord | null> {
    const response = await fetch(this.url(gameID), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`archive API ${response.status} ${response.statusText}`);
    }
    return GameRecordSchema.parse(await response.json());
  }
}

let cached: ReplayStore | null = null;

/** Pure selection: REPLAY_DIR wins; dev defaults to ./replays; else the API. */
export function selectReplayStore(
  env: NodeJS.ProcessEnv,
  gameEnv: GameEnv,
): ReplayStore {
  const dir = env.REPLAY_DIR;
  if (dir !== undefined && dir !== "") {
    return new FileReplayStore(path.resolve(dir));
  }
  if (gameEnv === GameEnv.Dev) {
    return new FileReplayStore(path.resolve("replays"));
  }
  return new ApiReplayStore();
}

/** The store this process archives to and reads replays from. */
export function replayStore(): ReplayStore {
  cached ??= selectReplayStore(process.env, ServerEnv.env());
  return cached;
}

/** Test hook. */
export function setReplayStore(store: ReplayStore | null): void {
  cached = store;
}
