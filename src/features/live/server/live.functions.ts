// Live class server functions. Course staff schedule and run classes; Students join and answer.
import { createServerFn } from '@tanstack/react-start';
import { authedFn, roleFn, typedInput } from '#src/server/fn.ts';
import {
  FireQuizInput,
  HeartbeatInput,
  LiveAnswerInput,
  LiveRef,
  NoInput,
  ScheduleLiveInput,
} from './live.schema.ts';
import {
  answerLive,
  cancelLive,
  fireQuiz,
  heartbeat,
  liveControl,
  liveRoom,
  myLiveClasses,
  scheduleLive,
  staffLiveClasses,
} from './live.server.ts';

const STAFF = ['instructor', 'admin'] as const;

export const listStaffLiveClasses = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async ({ actor }) => staffLiveClasses(actor)));

export const scheduleLiveClass = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ScheduleLiveInput>())
  .handler(
    roleFn(STAFF, ScheduleLiveInput, async ({ actor, input }) => scheduleLive(actor, input)),
  );

export const cancelLiveClass = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof LiveRef>())
  .handler(roleFn(STAFF, LiveRef, async ({ actor, input }) => cancelLive(actor, input)));

export const getLiveControl = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof LiveRef>())
  .handler(roleFn(STAFF, LiveRef, async ({ actor, input }) => liveControl(actor, input)));

export const fireLiveQuiz = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof FireQuizInput>())
  .handler(roleFn(STAFF, FireQuizInput, async ({ actor, input }) => fireQuiz(actor, input)));

export const getMyLiveClasses = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => myLiveClasses(actor)));

export const getLiveRoom = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof LiveRef>())
  .handler(authedFn(LiveRef, async ({ actor, input }) => liveRoom(actor, input)));

export const sendLiveHeartbeat = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof HeartbeatInput>())
  .handler(authedFn(HeartbeatInput, async ({ actor, input }) => heartbeat(actor, input)));

export const answerLiveQuestion = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof LiveAnswerInput>())
  .handler(authedFn(LiveAnswerInput, async ({ actor, input }) => answerLive(actor, input)));
