import { internalQuery } from './_generated/server';
import { v, getConvexSize } from 'convex/values';
import { battleValues, orderKind, point } from './tacticalValues';
import { applyBattleOrder, tickBattle } from '../lib/tactics';

/** Admin-only, read-only reproduction of a simulation step in the real cloud runtime.
 * No game is created or changed. Execution duration is available in Convex logs.
 */
export const probe = internalQuery({
  args: {
    battle: v.object(battleValues),
    command: v.optional(
      v.object({
        owner: v.string(),
        ids: v.array(v.string()),
        order: orderKind,
        point: v.optional(point),
        target: v.optional(v.string()),
      }),
    ),
  },
  handler: (_ctx, { battle, command }) => {
    if (command) applyBattleOrder(battle, command);
    tickBattle(battle, battle.tickAt + 250);
    return {
      entities: battle.entities.length,
      bytes: getConvexSize(battle),
      tickAt: battle.tickAt,
      pendingUnits: command?.ids.length ?? 0,
    };
  },
});
