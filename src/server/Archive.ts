import z from "zod";
import {
  GameID,
  GameRecord,
  GameRecordSchema,
  ID,
  PartialGameRecord,
} from "../core/Schemas";
import { replacer } from "../core/Util";
import { logger } from "./Logger";
import { replayStore } from "./ReplayStore";
import { ServerEnv } from "./ServerEnv";

const log = logger.child({ component: "Archive" });

// FightWars: records go to the configured ReplayStore (a local gzip file
// per game by default) instead of straight to the upstream project's closed API.
// See ReplayStore.ts.

export async function archive(gameRecord: GameRecord) {
  try {
    const parsed = GameRecordSchema.safeParse(gameRecord);
    if (!parsed.success) {
      log.error(`invalid game record: ${z.prettifyError(parsed.error)}`, {
        gameID: gameRecord.info.gameID,
      });
      return;
    }
    const store = replayStore();
    await store.save(parsed.data);
    log.info("archived game record", {
      gameID: gameRecord.info.gameID,
      store: store.kind,
    });
    // FightWars: the API rates the ladder from finished records. The file
    // store already holds the replay, so this is best-effort and separate.
    if (store.kind !== "api") {
      await postRecordToApi(parsed.data);
    }
  } catch (error) {
    log.error(`error archiving game record: ${error}`, {
      gameID: gameRecord.info.gameID,
    });
    return;
  }
}

/**
 * Push a finished record to the FightWars API (`POST /game/:id`) so the
 * ladder updates. Skipped when no API key is configured or
 * ARCHIVE_TO_API=false; failures are logged, never thrown.
 */
export async function postRecordToApi(
  record: GameRecord,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (ServerEnv.apiKey() === "" || process.env.ARCHIVE_TO_API === "false") {
    return false;
  }
  const gameID = record.info.gameID;
  try {
    const response = await fetchImpl(
      `${ServerEnv.jwtIssuer()}/game/${gameID}`,
      {
        method: "POST",
        body: JSON.stringify(record, replacer),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ServerEnv.apiKey(),
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      log.warn("api did not accept game record", {
        gameID,
        status: response.status,
      });
      return false;
    }
    log.info("game record sent to api", { gameID });
    return true;
  } catch (error) {
    log.warn(`api unreachable for game record: ${error}`, { gameID });
    return false;
  }
}

export async function readGameRecord(
  gameId: GameID,
): Promise<GameRecord | null> {
  try {
    if (!ID.safeParse(gameId).success) {
      log.error(`invalid game ID: ${gameId}`);
      return null;
    }
    return await replayStore().load(gameId);
  } catch (error) {
    log.error(`error reading game record: ${error}`, {
      gameID: gameId,
    });
    return null;
  }
}

export function finalizeGameRecord(
  clientRecord: PartialGameRecord,
): GameRecord {
  return {
    ...clientRecord,
    gitCommit: ServerEnv.gitCommit(),
    subdomain: ServerEnv.subdomain(),
    domain: ServerEnv.domain(),
  };
}
