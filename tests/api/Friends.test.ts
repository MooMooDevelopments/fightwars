// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FriendRequestsResponseSchema,
  FriendsListResponseSchema,
  SendFriendRequestResponseSchema,
  UserMeResponseSchema,
} from "../../src/core/ApiSchemas";
import {
  call,
  guest,
  startTestApi,
  type Session,
  type TestApi,
} from "./fixtures";

let api: TestApi;
let alice: Session;
let bob: Session;
let carol: Session;

beforeAll(async () => {
  api = await startTestApi();
  [alice, bob, carol] = await Promise.all(
    [1, 2, 3].map(() => guest(api.base, randomUUID())),
  );
});

afterAll(async () => {
  await api.close();
});

const requests = async (s: Session) =>
  FriendRequestsResponseSchema.parse(
    (await call(api.base, s, "GET", "/friends/requests")).json,
  );
const friends = async (s: Session) =>
  FriendsListResponseSchema.parse(
    (await call(api.base, s, "GET", "/friends?page=1&limit=20")).json,
  );

describe("friends", () => {
  it("requires a session and a real, other player", async () => {
    expect((await call(api.base, null, "GET", "/friends")).status).toBe(401);
    expect(
      (await call(api.base, alice, "POST", "/friends/requests/nobody")).status,
    ).toBe(404);
    expect(
      (
        await call(
          api.base,
          alice,
          "POST",
          `/friends/requests/${alice.publicId}`,
        )
      ).status,
    ).toBe(400);
  });

  it("sends a request, lists it on both sides, and a reverse request accepts it", async () => {
    const sent = await call(
      api.base,
      alice,
      "POST",
      `/friends/requests/${bob.publicId}`,
    );
    expect(sent.status).toBe(200);
    expect(SendFriendRequestResponseSchema.parse(sent.json).status).toBe(
      "requested",
    );
    expect(
      (await call(api.base, alice, "POST", `/friends/requests/${bob.publicId}`))
        .status,
    ).toBe(409);

    expect((await requests(alice)).outgoing.map((r) => r.publicId)).toEqual([
      bob.publicId,
    ]);
    expect((await requests(bob)).incoming.map((r) => r.publicId)).toEqual([
      alice.publicId,
    ]);

    const back = await call(
      api.base,
      bob,
      "POST",
      `/friends/requests/${alice.publicId}`,
    );
    expect(SendFriendRequestResponseSchema.parse(back.json).status).toBe(
      "accepted",
    );
    expect((await friends(alice)).results.map((f) => f.publicId)).toEqual([
      bob.publicId,
    ]);
    expect((await friends(bob)).total).toBe(1);
    expect((await requests(bob)).incoming).toEqual([]);
    expect(
      (await call(api.base, alice, "POST", `/friends/requests/${bob.publicId}`))
        .status,
    ).toBe(409);

    const me = UserMeResponseSchema.parse(
      (await call(api.base, alice, "GET", "/users/@me")).json,
    );
    expect(me.player.friends).toEqual([bob.publicId]);
  });

  it("accepts and declines through the request routes, and removes friends", async () => {
    await call(api.base, carol, "POST", `/friends/requests/${alice.publicId}`);
    expect(
      (
        await call(
          api.base,
          alice,
          "POST",
          `/friends/requests/${carol.publicId}/accept`,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await call(
          api.base,
          alice,
          "POST",
          `/friends/requests/${carol.publicId}/accept`,
        )
      ).status,
    ).toBe(404);
    expect((await friends(alice)).total).toBe(2);

    await call(api.base, carol, "POST", `/friends/requests/${bob.publicId}`);
    expect(
      (
        await call(
          api.base,
          bob,
          "DELETE",
          `/friends/requests/${carol.publicId}`,
        )
      ).status,
    ).toBe(204);
    expect((await requests(carol)).outgoing).toEqual([]);

    expect(
      (await call(api.base, alice, "DELETE", `/friends/${bob.publicId}`))
        .status,
    ).toBe(204);
    expect(
      (await call(api.base, alice, "DELETE", `/friends/${bob.publicId}`))
        .status,
    ).toBe(404);
    expect((await friends(bob)).results).toEqual([]);
    expect((await friends(alice)).results.map((f) => f.publicId)).toEqual([
      carol.publicId,
    ]);
  });
});
