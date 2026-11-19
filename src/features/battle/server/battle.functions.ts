// Battle server functions. Students play; Instructors and Admins schedule hosted battles.
import { createServerFn } from '@tanstack/react-start';
import { authedFn, roleFn, typedInput } from '#src/server/fn.ts';
import {
  BattleAnswerInput,
  BattleRef,
  CreateRoomInput,
  JoinByCodeInput,
  NoInput,
  QuickMatchInput,
  ScheduleBattleInput,
} from './battle.schema.ts';
import {
  answerBattle,
  battleHome,
  createRoom,
  finishBattle,
  getBattle,
  joinByCode,
  joinHosted,
  leaveBattle,
  listHostedBattles,
  quickMatch,
  scheduleBattle,
  startRoom,
} from './battle.server.ts';

export const getMyBattleHome = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => battleHome(actor)));

export const findQuickMatch = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof QuickMatchInput>())
  .handler(authedFn(QuickMatchInput, async ({ actor, input }) => quickMatch(actor, input)));

export const createBattleRoom = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof CreateRoomInput>())
  .handler(authedFn(CreateRoomInput, async ({ actor, input }) => createRoom(actor, input)));

export const joinBattleRoom = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof JoinByCodeInput>())
  .handler(authedFn(JoinByCodeInput, async ({ actor, input }) => joinByCode(actor, input)));

export const joinHostedBattle = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof BattleRef>())
  .handler(authedFn(BattleRef, async ({ actor, input }) => joinHosted(actor, input)));

export const startBattleRoom = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof BattleRef>())
  .handler(authedFn(BattleRef, async ({ actor, input }) => startRoom(actor, input)));

export const leaveMyBattle = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof BattleRef>())
  .handler(authedFn(BattleRef, async ({ actor, input }) => leaveBattle(actor, input)));

export const getMyBattle = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof BattleRef>())
  .handler(authedFn(BattleRef, async ({ actor, input }) => getBattle(actor, input)));

export const answerBattleQuestion = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof BattleAnswerInput>())
  .handler(authedFn(BattleAnswerInput, async ({ actor, input }) => answerBattle(actor, input)));

export const finishMyBattle = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof BattleRef>())
  .handler(authedFn(BattleRef, async ({ actor, input }) => finishBattle(actor, input)));

const STAFF = ['instructor', 'admin'] as const;

export const scheduleHostedBattle = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ScheduleBattleInput>())
  .handler(
    roleFn(STAFF, ScheduleBattleInput, async ({ actor, input }) => scheduleBattle(actor, input)),
  );

export const listMyHostedBattles = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async ({ actor }) => listHostedBattles(actor)));
