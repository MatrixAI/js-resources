import type { ContextBodyExit } from '@matrixai/contexts';
import { describe, expect, test } from 'vitest';
import { createResourceScope, withF, withG } from '@matrixai/resources';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('resource ownership', () => {
  test('direct lists support synchronous and asynchronous bodies', async () => {
    const events: Array<string> = [];
    const acquisitions = [
      () => ({
        resource: 2,
        release: () => {
          events.push('release');
        },
      }),
    ] as const;
    expect(await withF(acquisitions, ([value]) => value + 1)).toBe(3);
    expect(await withF(acquisitions, async ([value]) => value + 2)).toBe(4);
    expect(events).toEqual(['release', 'release']);
  });

  test('synchronous generators are driven asynchronously through cleanup', async () => {
    const events: Array<string> = [];
    const acquisitions = [
      () => ({
        resource: 2,
        release: async () => {
          events.push('release');
        },
      }),
    ] as const;
    const iterator = withG(acquisitions, function* ([value]) {
      try {
        yield value;
      } finally {
        events.push('finally');
      }
    });
    expect(await iterator.next()).toEqual({ value: 2, done: false });
    await iterator.return(undefined);
    expect(events).toEqual(['finally', 'release']);
  });

  test('acquires sequentially with snapshots and releases in reverse order', async () => {
    const events: Array<string> = [];
    const acquisitions = [
      async () => {
        events.push('acquire:first');
        return {
          resource: 3,
          release: () => {
            events.push('release:first');
          },
        };
      },
      async ([first]: readonly [number]) => {
        expect(first).toBe(3);
        events.push('acquire:second');
        return {
          resource: String(first),
          release: () => {
            events.push('release:second');
          },
        };
      },
    ] as const;
    expect(
      await withF(acquisitions, ([first, second]) => `${first}:${second}`),
    ).toBe('3:3');
    expect(events).toEqual([
      'acquire:first',
      'acquire:second',
      'release:second',
      'release:first',
    ]);
  });

  test.each([0, 1, 2])(
    'rolls back completed acquisitions when step %i fails',
    async (failure) => {
      const events: Array<number> = [];
      const reason = { failure };
      const step = (index: number) => async () => {
        if (index === failure) throw reason;
        return {
          resource: index,
          release: () => {
            events.push(index);
          },
        };
      };
      await expect(
        withF([step(0), step(1), step(2)], () => 'unreachable'),
      ).rejects.toBe(reason);
      expect(events).toEqual(
        Array.from({ length: failure }, (_, i) => failure - i - 1),
      );
    },
  );

  test('preserves arbitrary primary failures and every cleanup failure', async () => {
    const primary = undefined;
    const first = { cleanup: 1 };
    const second = 'cleanup:2';
    const exits: Array<ContextBodyExit<unknown>> = [];
    const acquisitions = [
      () => ({
        resource: 1,
        release: (exit: ContextBodyExit<unknown>) => {
          exits.push(exit);
          throw first;
        },
      }),
      () => ({
        resource: 2,
        release: (exit: ContextBodyExit<unknown>) => {
          exits.push(exit);
          throw second;
        },
      }),
    ] as const;
    let caught: unknown;
    try {
      await withF(acquisitions, () => {
        throw primary;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SuppressedError);
    const combined = caught as SuppressedError;
    expect(combined.suppressed).toBe(primary);
    expect((combined.error as AggregateError).errors).toEqual([second, first]);
    expect(exits).toEqual([
      { status: 'rejected', reason: primary },
      { status: 'rejected', reason: primary },
    ]);
  });

  test('preserves rollback errors alongside acquisition failure', async () => {
    const primary = new Error('acquire');
    const cleanup = new Error('release');
    const acquisitions = [
      () => ({
        resource: 1,
        release: () => {
          throw cleanup;
        },
      }),
      () => {
        throw primary;
      },
    ] as const;
    try {
      await withF(acquisitions, () => undefined);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(SuppressedError);
      expect((error as SuppressedError).suppressed).toBe(primary);
      expect(
        ((error as SuppressedError).error as AggregateError).errors,
      ).toEqual([cleanup]);
    }
  });

  test('reports every release failure even when the body succeeds', async () => {
    const acquisitions = [
      () => ({
        resource: 1,
        release: () => {
          throw 'first';
        },
      }),
      () => ({
        resource: 2,
        release: () => {
          throw 'second';
        },
      }),
    ] as const;
    await expect(withF(acquisitions, () => 3)).rejects.toMatchObject({
      errors: ['second', 'first'],
    });
  });

  test('holds resources until represented body and release have completed', async () => {
    const body = deferred<void>();
    const release = deferred<void>();
    const releasing = deferred<void>();
    const events: Array<string> = [];
    const acquisitions = [
      () => ({
        resource: 1,
        release: async () => {
          events.push('release');
          releasing.resolve();
          await release.promise;
        },
      }),
    ] as const;
    let settled = false;
    const result = withF(acquisitions, async () => {
      events.push('body');
      await body.promise;
      return 42;
    }).then((value) => {
      settled = true;
      return value;
    });
    body.resolve();
    await releasing.promise;
    expect(settled).toBe(false);
    release.resolve();
    expect(await result).toBe(42);
    expect(events).toEqual(['body', 'release']);
  });

  test('an already aborted signal prevents acquisition', async () => {
    const reason = { aborted: true };
    const controller = new AbortController();
    controller.abort(reason);
    let acquired = false;
    const acquisitions = [
      () => {
        acquired = true;
        return { resource: 1, release: () => {} };
      },
    ] as const;
    await expect(
      withF(acquisitions, () => undefined, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(acquired).toBe(false);
  });

  test('rolls back a lease acquired after cancellation without entering the body', async () => {
    const pending = deferred<void>();
    const entered = deferred<void>();
    const controller = new AbortController();
    const reason = { cancelled: true };
    const events: Array<string> = [];
    const acquisitions = [
      async () => {
        entered.resolve();
        await pending.promise;
        return {
          resource: 1,
          release: () => {
            events.push('release');
          },
        };
      },
    ] as const;
    const result = withF(
      acquisitions,
      () => {
        events.push('body');
      },
      { signal: controller.signal },
    );
    await entered.promise;
    controller.abort(reason);
    pending.resolve();
    await expect(result).rejects.toBe(reason);
    expect(events).toEqual(['release']);
  });

  test('cancellation during body does not release until body finishes', async () => {
    const body = deferred<void>();
    const entered = deferred<void>();
    const controller = new AbortController();
    const events: Array<string> = [];
    const acquisitions = [
      () => ({
        resource: 1,
        release: () => {
          events.push('release');
        },
      }),
    ] as const;
    const result = withF(
      acquisitions,
      async () => {
        entered.resolve();
        await body.promise;
      },
      { signal: controller.signal },
    );
    await entered.promise;
    controller.abort();
    expect(events).toEqual([]);
    body.resolve();
    await result;
    expect(events).toEqual(['release']);
  });

  test('composes scopes and retains outer resources through inner cleanup', async () => {
    const events: Array<string> = [];
    const outer = createResourceScope([
      () => ({
        resource: 'outer',
        release: () => {
          events.push('outer');
        },
      }),
    ] as const);
    const inner = createResourceScope([
      () => ({
        resource: 'inner',
        release: () => {
          events.push('inner');
        },
      }),
    ] as const);
    const operation = outer(async ({ resources }) => {
      expect(resources).toEqual(['outer']);
      return inner(async ({ resources: nested }) => {
        expect(nested).toEqual(['inner']);
        return 'done';
      })({});
    });
    expect(await operation({})).toBe('done');
    expect(events).toEqual(['inner', 'outer']);
  });

  test('generator is lazy, owns suspended yields and releases on close', async () => {
    const events: Array<string> = [];
    const acquisitions = [
      () => {
        events.push('acquire');
        return {
          resource: 1,
          release: () => {
            events.push('release');
          },
        };
      },
    ] as const;
    const untouched = withG(acquisitions, async function* () {
      yield 1;
    });
    await untouched.return(undefined);
    expect(events).toEqual([]);
    const generator = withG(acquisitions, async function* ([value]) {
      try {
        yield value;
      } finally {
        events.push('finally');
      }
    });
    expect(events).toEqual([]);
    expect(await generator.next()).toEqual({ value: 1, done: false });
    expect(events).toEqual(['acquire']);
    await generator.return(undefined);
    expect(events).toEqual(['acquire', 'finally', 'release']);
  });

  test('generator rejects overlap and yielded disposal requires advancement', async () => {
    const pending = deferred<void>();
    const entered = deferred<void>();
    const events: Array<string> = [];
    const acquisitions = [
      () => ({
        resource: 1,
        release: () => {
          events.push('release');
        },
      }),
    ] as const;
    const generator = withG(acquisitions, async function* () {
      try {
        entered.resolve();
        await pending.promise;
        yield 1;
      } finally {
        yield 2;
      }
    });
    const first = generator.next();
    await entered.promise;
    await expect(generator.next()).rejects.toThrow('Overlapping');
    pending.resolve();
    expect((await first).value).toBe(1);
    await expect(generator[Symbol.asyncDispose]()).rejects.toThrow(
      'explicit advancement',
    );
    expect(events).toEqual([]);
    expect((await generator.next()).done).toBe(true);
    expect(events).toEqual(['release']);
  });

  test('generator failure and release failure remain observable together', async () => {
    const primary = new Error('generator');
    const cleanup = new Error('release');
    const acquisitions = [
      () => ({
        resource: 1,
        release: () => {
          throw cleanup;
        },
      }),
    ] as const;
    const iterator = withG(acquisitions, async function* () {
      yield 1;
      throw primary;
    });
    await iterator.next();
    try {
      await iterator.next();
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(SuppressedError);
      expect((error as SuppressedError).suppressed).toBe(primary);
      expect(
        ((error as SuppressedError).error as AggregateError).errors,
      ).toEqual([cleanup]);
    }
  });
});
