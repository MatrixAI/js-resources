import { describe, expect, test } from 'vitest';
import { LifecycleGate } from '@matrixai/async-init/lifecycle/index.js';
import { requireResources } from '@matrixai/resources';
import { resourceful } from '@matrixai/resources/functions';
import { resourceful as resourcefulMethod } from '@matrixai/resources/decorators';

type RequestContext = {
  readonly requestId: string;
  readonly signal?: AbortSignal;
  readonly resources?: readonly [number];
};

describe('resource function and standard method facades', () => {
  test('resource facades preserve active lifecycle admission without reviving stale tokens', async () => {
    const gate = new LifecycleGate();
    const original = { requestId: 'request' };
    const projected: RequestContext[] = [];
    let released = 0;
    const acquisitions = [
      () => ({
        resource: 7,
        release: () => {
          released++;
        },
      }),
    ] as const;
    function inspect(context: RequestContext): number {
      expect(gate.currentAccess(context)).toBe('reader');
      projected.push(context);
      return requireResources(context)[0];
    }
    function* generator(
      context: RequestContext,
    ): Generator<number, void, unknown> {
      yield inspect(context);
    }
    async function* asyncGenerator(
      context: RequestContext,
    ): AsyncGenerator<number, void, unknown> {
      yield inspect(context);
    }
    const options = { context: 0 as const, acquisitions };
    class Service {
      @resourcefulMethod({ ...options, kind: 'async' })
      async read(context: RequestContext) {
        return inspect(context);
      }
    }
    await gate.runReader(async (admitted) => {
      const context = admitted as RequestContext;
      expect(resourceful(inspect, { ...options, kind: 'sync' })(context)).toBe(
        7,
      );
      await expect(
        resourceful(async (value: RequestContext) => inspect(value), {
          ...options,
          kind: 'async',
        })(context),
      ).resolves.toBe(7);
      expect([
        ...resourceful(generator, { ...options, kind: 'generator' })(context),
      ]).toEqual([7]);
      const values: number[] = [];
      for await (const value of resourceful(asyncGenerator, {
        ...options,
        kind: 'async-generator',
      })(context)) {
        values.push(value);
      }
      expect(values).toEqual([7]);
      await expect(new Service().read(context)).resolves.toBe(7);
    }, original);
    expect(released).toBe(5);
    expect(projected).toHaveLength(5);
    await gate.runWriter((admitted) => {
      expect(gate.currentAccess(admitted)).toBe('writer');
      for (const stale of projected) {
        expect(gate.currentAccess(stale)).toBeUndefined();
        expect(gate.tryRunReaderSync(() => 'bypassed', stale)).toBeUndefined();
      }
    }, original);
  });

  test('preserves the receiver, arguments, result and cleanup for sync and async methods', async () => {
    const events: Array<string> = [];
    const acquisitions = [
      () => ({
        resource: 7,
        release: () => {
          events.push('release');
        },
      }),
    ] as const;
    class Service {
      public readonly prefix = 'service';

      @resourcefulMethod({ context: 1, kind: 'sync', acquisitions })
      public read(id: string, context: RequestContext): string {
        const [resource] = requireResources(context);
        return `${this.prefix}:${id}:${context.requestId}:${resource}`;
      }

      @resourcefulMethod({ context: 1, kind: 'async', acquisitions })
      public async readAsync(
        id: string,
        context: RequestContext,
      ): Promise<string> {
        const [resource] = requireResources(context);
        return `${this.prefix}:${id}:${context.requestId}:${resource}`;
      }
    }
    const service = new Service();
    const expected = 'service:item:request:7';
    expect(service.read('item', { requestId: 'request' })).toBe(expected);
    expect(await service.readAsync('item', { requestId: 'request' })).toBe(
      expected,
    );
    expect(events).toEqual(['release', 'release']);

    function read(this: Service, id: string, context: RequestContext): string {
      return `${this.prefix}:${id}:${context.requestId}:${requireResources(context)[0]}`;
    }
    const wrapped = resourceful(read, {
      context: 1,
      kind: 'sync',
      acquisitions,
    });
    expect(wrapped.call(service, 'item', { requestId: 'request' })).toBe(
      expected,
    );
    expect(events).toEqual(['release', 'release', 'release']);
  });

  test('generator methods retain resources until exhaustion or explicit close', async () => {
    const events: Array<string> = [];
    const acquisitions = [
      () => ({
        resource: 9,
        release: () => {
          events.push('release');
        },
      }),
    ] as const;
    class Service {
      @resourcefulMethod({ context: 0, kind: 'generator', acquisitions })
      public *values(
        context: RequestContext,
      ): Generator<number, void, unknown> {
        try {
          yield requireResources(context)[0];
        } finally {
          events.push('finally');
        }
      }

      @resourcefulMethod({ context: 0, kind: 'async-generator', acquisitions })
      public async *valuesAsync(
        context: RequestContext,
      ): AsyncGenerator<number, void, unknown> {
        try {
          yield requireResources(context)[0];
        } finally {
          events.push('finally');
        }
      }
    }
    const service = new Service();
    const iterator = service.values({ requestId: 'sync' });
    expect(events).toEqual([]);
    expect(iterator.next()).toEqual({ done: false, value: 9 });
    iterator.return(undefined);
    expect(events).toEqual(['finally', 'release']);
    const asyncIterator = service.valuesAsync({ requestId: 'async' });
    expect(await asyncIterator.next()).toEqual({ done: false, value: 9 });
    await asyncIterator.return(undefined);
    expect(events).toEqual(['finally', 'release', 'finally', 'release']);
  });

  test('selects acquisitions per receiver and arguments, preserving record descriptors', () => {
    const events: Array<string> = [];
    const admission = Symbol('admission');
    const token = {};
    class Service {
      public readonly prefix = 'service';
    }
    function read(this: Service, id: string, context: RequestContext): string {
      expect(
        Object.getOwnPropertyDescriptor(context, 'hidden')?.enumerable,
      ).toBe(false);
      expect(Object.getOwnPropertyDescriptor(context, admission)).toEqual({
        value: token,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      return `${this.prefix}:${id}:${requireResources(context)[0]}`;
    }
    const wrapped = resourceful(read, {
      context: 1,
      kind: 'sync',
      acquisitions(this: Service, id: string, _context: RequestContext) {
        events.push(`${this.prefix}:${id}`);
        return [
          () => ({
            resource: id.length,
            release: () => {
              events.push('release');
            },
          }),
        ] as const;
      },
    });
    const context: RequestContext = { requestId: 'request' };
    Object.defineProperty(context, 'hidden', { value: 3, enumerable: false });
    Object.defineProperty(context, admission, {
      value: token,
      enumerable: false,
    });
    Object.defineProperty(context, 'resources', { value: undefined });
    expect(wrapped.call(new Service(), 'abc', context)).toBe('service:abc:3');
    expect(events).toEqual(['service:abc', 'release']);
    expect(context.resources).toBeUndefined();
  });

  test('rejects pre-aborted calls before acquisition for functions and methods', async () => {
    let acquired = false;
    const acquisitions = [
      () => {
        acquired = true;
        return { resource: 1, release: () => {} };
      },
    ] as const;
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    const wrapped = resourceful(
      async (context: RequestContext) => context.requestId,
      { context: 0, kind: 'async', acquisitions },
    );
    class Service {
      @resourcefulMethod({ context: 0, kind: 'async', acquisitions })
      public async read(context: RequestContext): Promise<string> {
        return context.requestId;
      }
    }
    const context = { requestId: 'x', signal: controller.signal };
    await expect(wrapped(context)).rejects.toBe(reason);
    await expect(new Service().read(context)).rejects.toBe(reason);
    expect(acquired).toBe(false);
  });

  test('function and method forms retain primary and cleanup failures equally', async () => {
    const primary = { body: true };
    const cleanup = { release: true };
    const acquisitions = [
      () => ({
        resource: 1,
        release: () => {
          throw cleanup;
        },
      }),
    ] as const;
    const wrapped = resourceful(
      async (_context: RequestContext): Promise<void> => {
        throw primary;
      },
      { context: 0, kind: 'async', acquisitions },
    );
    class Service {
      @resourcefulMethod({ context: 0, kind: 'async', acquisitions })
      public async read(_context: RequestContext): Promise<void> {
        throw primary;
      }
    }
    for (const operation of [wrapped, new Service().read.bind(new Service())]) {
      let caught: unknown;
      try {
        await operation({ requestId: 'x' });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SuppressedError);
      expect((caught as SuppressedError).suppressed).toBe(primary);
      expect(
        ((caught as SuppressedError).error as AggregateError).errors,
      ).toEqual([cleanup]);
    }
  });

  test('generator function forms select lazily and preserve early-close cleanup', async () => {
    const events: Array<string> = [];
    const acquisitions = () => {
      events.push('select');
      return [
        () => ({
          resource: 2,
          release: () => {
            events.push('release');
          },
        }),
      ] as const;
    };
    function* sync(context: RequestContext): Generator<number, void, unknown> {
      yield requireResources(context)[0];
    }
    async function* asyncBody(
      context: RequestContext,
    ): AsyncGenerator<number, void, unknown> {
      yield requireResources(context)[0];
    }
    const syncFunction = resourceful(sync, {
      context: 0,
      kind: 'generator',
      acquisitions,
    });
    const asyncFunction = resourceful(asyncBody, {
      context: 0,
      kind: 'async-generator',
      acquisitions,
    });
    const first = syncFunction({ requestId: 'sync' });
    const second = asyncFunction({ requestId: 'async' });
    expect(events).toEqual([]);
    expect(first.next().value).toBe(2);
    expect((await second.next()).value).toBe(2);
    first.return(undefined);
    await second.return(undefined);
    expect(events).toEqual(['select', 'select', 'release', 'release']);
  });

  test('rejects invalid context records before selecting acquisitions', () => {
    let selected = false;
    const wrapped = resourceful(
      (context: RequestContext) => context.requestId,
      {
        context: 0,
        kind: 'sync',
        acquisitions: () => {
          selected = true;
          return [() => ({ resource: 1, release: () => {} })] as const;
        },
      },
    );
    const context = Object.defineProperty({ requestId: 'x' }, 'signal', {
      get: () => undefined,
    });
    expect(() => wrapped(context)).toThrow('own data fields');
    expect(selected).toBe(false);
  });
});
