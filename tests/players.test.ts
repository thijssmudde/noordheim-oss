import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import {
  createPlayerKey,
  isPlayerKey,
  normalizeRecoveryKey,
} from '../lib/player-identity';
import { CULTURES, cultureKeys, isCulture } from '../lib/cultures';
const modules = import.meta.glob('../convex/**/*.ts');
const alice = 'a'.repeat(64),
  bob = 'b'.repeat(64);
describe('Enrolling commanders', () => {
  test('visiting the entrance creates nothing; enrolment needs a key, a name and a culture', async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.players.lobby, {})).toEqual({
      playerCount: 0,
      openLobbies: 0,
      operation: null,
    });
    expect(await t.query(api.players.session, { token: alice })).toBeNull();
    await expect(
      t.mutation(api.players.connect, { token: alice }),
    ).rejects.toThrow('commander name');
    await expect(
      t.mutation(api.players.connect, { token: 'short', name: 'Alice' }),
    ).rejects.toThrow('session key');
    await expect(
      t.mutation(api.players.connect, {
        token: alice,
        name: 'Alice',
        culture: 'martian',
      }),
    ).rejects.toThrow('culture');
    expect(
      await t.run((ctx) => ctx.db.query('players').collect()),
    ).toHaveLength(0);
  });
  test('names are unique, keys are idempotent, and sessions expose only public details', async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.players.connect, {
      token: alice,
      name: '  Alice  ',
      culture: 'hearthkin',
    });
    expect(await t.mutation(api.players.connect, { token: alice })).toBe(id);
    await expect(
      t.mutation(api.players.connect, { token: bob, name: 'alice' }),
    ).rejects.toThrow('already taken');
    await t.mutation(api.players.connect, { token: bob, name: 'Bob' });
    const session = (await t.query(api.players.session, { token: alice }))!;
    expect(session).toEqual({ _id: id, name: 'Alice', culture: 'hearthkin' });
    expect(JSON.stringify(session)).not.toContain(alice);
    expect(
      await t.query(api.players.session, { token: 'c'.repeat(64) }),
    ).toBeNull();
    const lobby = await t.query(api.players.lobby, {});
    expect(lobby.playerCount).toBe(2);
    expect(lobby.operation).toBeNull();
    await t.mutation(api.tactics.deploy, { token: alice });
    expect((await t.query(api.players.lobby, {})).operation).toMatchObject({
      status: 'active',
      commanders: 1,
    });
  });
  test('recovery keys are 64 hex characters, normalised from pasted text', () => {
    const key = createPlayerKey();
    expect(isPlayerKey(key)).toBe(true);
    expect(
      normalizeRecoveryKey(
        ` ${key.toUpperCase().slice(0, 32)}-${key.slice(32)} `,
      ),
    ).toBe(key);
    expect(isPlayerKey('nope')).toBe(false);
    for (const c of cultureKeys) expect(isCulture(c)).toBe(true);
    expect(isCulture('martian')).toBe(false);
    expect(Object.keys(CULTURES)).toHaveLength(4);
  });
});
