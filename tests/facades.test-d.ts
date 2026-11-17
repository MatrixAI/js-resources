import { expectTypeOf, test } from 'vitest';
import { resourceful } from '@matrixai/resources/functions';
import { resourceful as resourcefulMethod } from '@matrixai/resources/decorators';

type Context = {
  requestId: string;
  resources?: readonly [number];
  signal?: AbortSignal;
};
const acquisitions = [() => ({ resource: 1, release: () => {} })] as const;

test('checks selected arguments, supplied resources and return protocols', () => {
  const sync = resourceful((context: Context) => context.requestId, {
    context: 0,
    kind: 'sync',
    acquisitions,
  });
  expectTypeOf(sync({ requestId: 'x' })).toEqualTypeOf<string>();
  const asyncFunction = resourceful(
    async (context: Context) => context.requestId,
    { context: 0, kind: 'async', acquisitions },
  );
  expectTypeOf(asyncFunction({ requestId: 'x' })).toEqualTypeOf<
    Promise<string>
  >();
  function* values(_context: Context): Generator<number, void, unknown> {
    yield 1;
  }
  expectTypeOf(
    resourceful(values, { context: 0, kind: 'generator', acquisitions })({
      requestId: 'x',
    }).next(),
  ).toEqualTypeOf<IteratorResult<number, void>>();
  async function* updates(
    _context: Context,
  ): AsyncGenerator<number, void, unknown> {
    yield 1;
  }
  expectTypeOf(
    resourceful(updates, { context: 0, kind: 'async-generator', acquisitions })(
      { requestId: 'x' },
    ).next(),
  ).toEqualTypeOf<Promise<IteratorResult<number, void>>>();

  // @ts-expect-error The selected argument must exist.
  resourceful((context: Context) => context.requestId, {
    context: 2,
    kind: 'sync',
    acquisitions,
  });
  // @ts-expect-error An optional context parameter is not a supported selection.
  resourceful((context?: Context) => context?.requestId, {
    context: 0,
    kind: 'sync',
    acquisitions,
  });
  // @ts-expect-error Rest arguments do not identify a fixed context slot.
  resourceful((...contexts: Context[]) => contexts.length, {
    context: 0,
    kind: 'sync',
    acquisitions,
  });
  // @ts-expect-error A sync wrapper cannot preserve an async function's protocol.
  resourceful(async (context: Context) => context.requestId, {
    context: 0,
    kind: 'sync',
    acquisitions,
  });
  // @ts-expect-error The provider cannot supply a string inventory.
  resourceful((context: { resources?: readonly [string] }) => context, {
    context: 0,
    kind: 'sync',
    acquisitions,
  });
  const supplied = resourceful(
    (context: { requestId: string; resources: readonly [number] }) =>
      context.resources[0],
    { context: 0, kind: 'sync', acquisitions },
  );
  expectTypeOf(supplied({ requestId: 'x' })).toEqualTypeOf<number>();
  // @ts-expect-error A synchronous owner cannot acquire asynchronously.
  resourceful((context: Context) => context.requestId, {
    context: 0,
    kind: 'sync',
    acquisitions: [async () => ({ resource: 1, release: () => {} })],
  });
  // @ts-expect-error A synchronous owner cannot release asynchronously.
  resourceful((context: Context) => context.requestId, {
    context: 0,
    kind: 'sync',
    acquisitions: [() => ({ resource: 1, release: async () => {} })],
  });

  class Service {
    @resourcefulMethod({ context: 0, kind: 'sync', acquisitions })
    public read(context: Context): string {
      return context.requestId;
    }

    // @ts-expect-error Standard decorators cannot remove required caller arguments.
    @resourcefulMethod({ context: 0, kind: 'sync', acquisitions })
    public invalid(context: { resources: readonly [number] }): string {
      return String(context.resources[0]);
    }
  }
  expectTypeOf(new Service().read({ requestId: 'x' })).toEqualTypeOf<string>();
});
