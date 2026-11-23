import { describe, expect, test } from 'vitest';
import { withF, withG } from '@matrixai/resources';

describe('synchronous ownership', () => {
  test('returns synchronously and releases dependent acquisitions in reverse order', () => {
    const events: Array<string> = [];
    const result = withF(
      [
        () => ({
          resource: 3,
          release: () => {
            events.push('first');
          },
        }),
        ([first]: readonly [number]) => ({
          resource: String(first),
          release: () => {
            events.push('second');
          },
        }),
      ] as const,
      ([first, second]) => `${first}:${second}`,
      { kind: 'sync' },
    );
    expect(result).toBe('3:3');
    expect(events).toEqual(['second', 'first']);
  });

  test.each([0, 1, 2])(
    'rolls back preceding steps when acquisition %i fails',
    (failure) => {
      const events: Array<number> = [];
      const reason = { failure };
      const acquire = (index: number) => () => {
        if (index === failure) throw reason;
        return {
          resource: index,
          release: () => {
            events.push(index);
          },
        };
      };
      expect(() =>
        withF([acquire(0), acquire(1), acquire(2)], () => undefined, {
          kind: 'sync',
        }),
      ).toThrow(reason);
      expect(events).toEqual(
        Array.from({ length: failure }, (_, i) => failure - i - 1),
      );
    },
  );

  test('combines arbitrary primary and all cleanup failures', () => {
    const primary = undefined;
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
    let caught: unknown;
    try {
      withF(
        acquisitions,
        () => {
          throw primary;
        },
        { kind: 'sync' },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SuppressedError);
    expect((caught as SuppressedError).suppressed).toBe(primary);
    expect(
      ((caught as SuppressedError).error as AggregateError).errors,
    ).toEqual(['second', 'first']);
  });

  test('honors receiver-bound release methods', () => {
    const events: Array<number> = [];
    withF(
      [
        () => ({
          resource: 7,
          release() {
            events.push(this.resource);
          },
        }),
      ] as const,
      () => undefined,
      { kind: 'sync' },
    );
    expect(events).toEqual([7]);
  });

  test('rejects already-aborted entry without acquiring', () => {
    const controller = new AbortController();
    const reason = new Error('aborted');
    controller.abort(reason);
    let acquired = false;
    expect(() =>
      withF(
        [
          () => {
            acquired = true;
            return { resource: 1, release: () => {} };
          },
        ],
        () => 0,
        { kind: 'sync', signal: controller.signal },
      ),
    ).toThrow(reason);
    expect(acquired).toBe(false);
  });

  test('rolls back a lease returned after synchronous cancellation', () => {
    const controller = new AbortController();
    const reason = new Error('aborted');
    const events: Array<string> = [];
    expect(() =>
      withF(
        [
          () => {
            controller.abort(reason);
            return {
              resource: 1,
              release: () => {
                events.push('release');
              },
            };
          },
        ],
        () => {
          events.push('body');
        },
        { kind: 'sync', signal: controller.signal },
      ),
    ).toThrow(reason);
    expect(events).toEqual(['release']);
  });

  test('rejects untyped thenables while attempting every synchronous release', () => {
    const events: Array<string> = [];
    const asyncBody = (() => Promise.resolve(1)) as unknown as () => number;
    const asyncRelease = (() =>
      Promise.reject(new Error('late rejection'))) as unknown as () => void;
    let caught: unknown;
    try {
      withF(
        [
          () => ({
            resource: 1,
            release: () => {
              events.push('first');
            },
          }),
          () => ({ resource: 2, release: asyncRelease }),
        ],
        asyncBody,
        { kind: 'sync' },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SuppressedError);
    expect((caught as SuppressedError).suppressed).toBeInstanceOf(TypeError);
    expect(
      ((caught as SuppressedError).error as AggregateError).errors[0],
    ).toBeInstanceOf(TypeError);
    expect(events).toEqual(['first']);
  });

  test('generator is lazy and retains the inventory across yielded close', () => {
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
    const untouched = withG(
      acquisitions,
      function* () {
        yield 1;
      },
      { kind: 'generator' },
    );
    untouched.return(undefined);
    expect(events).toEqual([]);
    const iterator = withG(
      acquisitions,
      function* ([value]) {
        try {
          yield value;
        } finally {
          yield 2;
        }
      },
      { kind: 'generator' },
    );
    expect(iterator.next()).toEqual({ done: false, value: 1 });
    expect(() => iterator[Symbol.dispose]()).toThrow('explicit advancement');
    expect(events).toEqual(['acquire']);
    expect(iterator.next().done).toBe(true);
    expect(events).toEqual(['acquire', 'release']);
  });

  test('throw before start never acquires and reentrant advancement is rejected', () => {
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
    const untouched = withG(
      acquisitions,
      function* () {
        yield 1;
      },
      { kind: 'generator' },
    );
    const reason = new Error('before start');
    expect(() => untouched.throw(reason)).toThrow(reason);
    expect(untouched.next().done).toBe(true);
    expect(events).toEqual([]);
    let advance = () => {};
    const iterator = withG(
      acquisitions,
      function* () {
        expect(advance).toThrow('Overlapping generator operations');
        yield 1;
      },
      { kind: 'generator' },
    );
    advance = () => {
      iterator.next();
    };
    expect(iterator.next()).toEqual({ done: false, value: 1 });
    expect(iterator.return(undefined).done).toBe(true);
    expect(iterator.next().done).toBe(true);
    expect(events).toEqual(['acquire', 'release']);
  });

  test('generator failures retain cleanup failures', () => {
    const primary = new Error('body');
    const cleanup = new Error('cleanup');
    const iterator = withG(
      [
        () => ({
          resource: 1,
          release: () => {
            throw cleanup;
          },
        }),
      ],
      function* () {
        yield 1;
        throw primary;
      },
      { kind: 'generator' },
    );
    iterator.next();
    let caught: unknown;
    try {
      iterator.next();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SuppressedError);
    expect((caught as SuppressedError).suppressed).toBe(primary);
    expect(
      ((caught as SuppressedError).error as AggregateError).errors,
    ).toEqual([cleanup]);
  });
});
