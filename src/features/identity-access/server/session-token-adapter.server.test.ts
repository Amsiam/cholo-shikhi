// BR3.5: the session token is stored only as a hash; callers still see their raw token.
import { describe, expect, it } from 'vitest';
import { hashSessionToken, withHashedSessionTokens } from './session-token-adapter.server.ts';

type Call = { method: string; arg: Record<string, unknown> };
type Method = (arg: Record<string, unknown>) => Promise<{ token: string } | unknown[]>;
type FakeAdapter = {
  create: Method;
  findOne: Method;
  findMany: Method;
  update: Method;
  updateMany: Method;
  delete: Method;
  deleteMany: Method;
  count: Method;
  transaction: (cb: (trx: FakeAdapter) => Promise<unknown>) => Promise<unknown>;
};

function setup() {
  const calls: Call[] = [];
  const record =
    (method: string): Method =>
    async (arg) => {
      calls.push({ method, arg });
      return method === 'findOne' || method === 'create' ? { token: 'stored' } : [];
    };
  const fake: FakeAdapter = {
    create: record('create'),
    findOne: record('findOne'),
    findMany: record('findMany'),
    update: record('update'),
    updateMany: record('updateMany'),
    delete: record('delete'),
    deleteMany: record('deleteMany'),
    count: record('count'),
    transaction: async (cb) => cb(fake),
  };
  const adapter = withHashedSessionTokens((_options: unknown) => fake)(
    {} as never,
  ) as unknown as FakeAdapter;
  return { adapter, calls };
}

function argOf(calls: Call[], index = 0): Record<string, unknown> {
  const call = calls[index];
  if (!call) throw new Error(`no adapter call at ${index}`);
  return call.arg;
}
const whereValue = (calls: Call[]) => (argOf(calls).where as Array<{ value: unknown }>)[0]?.value;

describe('withHashedSessionTokens', () => {
  it('hashes the token on create and returns the raw token to the caller', async () => {
    const { adapter, calls } = setup();
    const created = (await adapter.create({ model: 'session', data: { token: 'raw-token' } })) as {
      token: string;
    };
    expect((argOf(calls).data as { token: string }).token).toBe(hashSessionToken('raw-token'));
    expect(created.token).toBe('raw-token');
  });

  it('hashes lookups and restores the raw token on the result', async () => {
    const { adapter, calls } = setup();
    const found = (await adapter.findOne({
      model: 'session',
      where: [{ field: 'token', value: 'raw-token' }],
    })) as { token: string };
    expect(whereValue(calls)).toBe(hashSessionToken('raw-token'));
    expect(found.token).toBe('raw-token');
  });

  it('never hashes an already-hashed value twice, including inside `in` lists', async () => {
    const { adapter, calls } = setup();
    const hashed = hashSessionToken('a');
    await adapter.deleteMany({
      model: 'session',
      where: [{ field: 'token', operator: 'in', value: [hashed, 'b'] }],
    });
    expect(whereValue(calls)).toEqual([hashed, hashSessionToken('b')]);
  });

  it('leaves other models untouched', async () => {
    const { adapter, calls } = setup();
    await adapter.findOne({ model: 'user', where: [{ field: 'token', value: 'x' }] });
    expect(whereValue(calls)).toBe('x');
  });

  it('wraps the transaction adapter too', async () => {
    const { adapter, calls } = setup();
    await adapter.transaction((trx) =>
      trx.update({
        model: 'session',
        where: [{ field: 'token', value: 'r' }],
        update: { token: 'n' },
      }),
    );
    expect(whereValue(calls)).toBe(hashSessionToken('r'));
    expect((argOf(calls).update as { token: string }).token).toBe(hashSessionToken('n'));
  });
});
