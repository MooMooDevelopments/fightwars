import z from "zod";
import {
  GameID,
  GameRecord,
  GameRecordSchema,
  ID,
  PartialGameRecord,
} from "../core/Schemas";
import { logger } from "./Logger";
import { replayStore } from "./ReplayStore";
import { ServerEnv } from "./ServerEnv";

const log = logger.child({ component: "Archive" });

// FightWars: records go to the configured ReplayStore (a local gzip file
// per game by default) instead of straight to OpenFront's closed API.
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
  } catch (error) {
    log.error(`error archiving game record: ${error}`, {
      gameID: gameRecord.info.gameID,
    });
    return;
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
