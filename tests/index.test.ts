import type { ResourceAcquire } from '@';
import { Mutex } from 'async-mutex';
import { withF, withG } from '@';

describe('index', () => {
  test('withF resource context', async () => {
    // No resources
    const result1 = await withF([], async () => {
      return 'bar';
    });
    expect(result1).toBe('bar');
    // Noop resource
    const result2 = await withF(
      [
        async () => {
          return [async () => {}];
        },
      ],
      async () => {
        return 'foo';
      },
    );
    expect(result2).toBe('foo');
    // Counter resource
    let counter = 1;
    const result3 = await withF(
      [
        async () => {
          counter++;
          return [
            async () => {
              counter--;
            },
            counter,
          ];
        },
      ],
      async ([c]) => {
        expect(c).toBe(2);
        return c / 2;
      },
    );
    expect(result3).toBe(1);
    expect(counter).toBe(1);
    // Multiple resources
    const result4 = await withF(
      [
        async () => {
          return [async () => {}, 123];
        },
        async () => {
          return [async () => {}];
        },
        async () => {
          return [async () => {}, 'hello world'];
        },
      ],
      async ([n, u, s]) => {
        expect(u).toBe(undefined);
        return [n, s];
      },
    );
    expect(result4).toStrictEqual([123, 'hello world']);
    // Multiple resources, but only take the first
    const result5 = await withF(
      [
        async () => {
          return [async () => {}, 123];
        },
        async () => {
          return [async () => {}];
        },
        async () => {
          return [async () => {}, 'hello world'];
        },
      ],
      async ([n]) => {
        return n;
      },
    );
    expect(result5).toBe(123);
    // Multiple resources outside requires type declaration
    const resourceAcquires6: [
      ResourceAcquire<number>,
      ResourceAcquire<void>,
      ResourceAcquire<string>,
    ] = [
      async () => {
        return [async () => {}, 123];
      },
      async () => {
        return [async () => {}];
      },
      async () => {
        return [async () => {}, 'hello world'];
      },
    ];
    const result6 = await withF(resourceAcquires6, async ([n, u, s]) => {
      expect(u).toBe(undefined);
      return [n, s];
    });
    expect(result6).toStrictEqual([123, 'hello world']);
    // Multiple resources outside can also use const
    const resourceAcquires7 = [
      async () => {
        return [async () => {}, 123] as const;
      },
      async () => {
        return [async () => {}] as const;
      },
      async () => {
        return [async () => {}, 'hello world'] as const;
      },
    ] as const;
    const result7 = await withF(resourceAcquires7, async ([n, u, s]) => {
      expect(u).toBe(undefined);
      return [n, s];
    });
    expect(result7).toStrictEqual([123, 'hello world']);
    // It must be given a explicit type, or `as const` can be used internally
    const acquire8: ResourceAcquire<number> = async () => {
      return [async () => {}, 123];
    };
    const result8 = await withF([acquire8], async () => {
      return 'done';
    });
    expect(result8).toBe('done');
    const acquire9 = async () => {
      return [async () => {}, 123] as const;
    };
    const result9 = await withF([acquire9], async () => {
      return 'done';
    });
    expect(result9).toBe('done');
    // Order of acquisition is left to right
    // Order of release is right ot left
    const lock1 = new Mutex();
    const lock2 = new Mutex();
    const acquireOrder: Array<Mutex> = [];
    const releaseOrder: Array<Mutex> = [];
    await withF(
      [
        async () => {
          const release = await lock1.acquire();
          acquireOrder.push(lock1);
          return [
            async () => {
              releaseOrder.push(lock1);
              release();
            },
            lock1,
          ];
        },
        async () => {
          const release = await lock2.acquire();
          acquireOrder.push(lock2);
          return [
            async () => {
              releaseOrder.push(lock2);
              release();
            },
            lock2,
          ];
        },
      ],
      async ([l1, l2]) => {
        expect(l1.isLocked()).toBe(true);
        expect(l2.isLocked()).toBe(true);
      },
    );
    expect(acquireOrder).toStrictEqual([lock1, lock2]);
    expect(releaseOrder).toStrictEqual([lock2, lock1]);
  });
  test('withG resource context', async () => {
    // No resources
    const g1 = withG([], async function* () {
      yield 'first';
      yield 'second';
      return 'last';
    });
    expect(await g1.next()).toStrictEqual({ value: 'first', done: false });
    expect(await g1.next()).toStrictEqual({ value: 'second', done: false });
    expect(await g1.next()).toStrictEqual({ value: 'last', done: true });
    // Noop resource
    const g2 = withG(
      [
        async () => {
          return [async () => {}];
        },
      ],
      async function* () {
        yield 'first';
        return 'last';
      },
    );
    expect(await g2.next()).toStrictEqual({ value: 'first', done: false });
    expect(await g2.next()).toStrictEqual({ value: 'last', done: true });
    // Order of acquisition is left to right
    // Order of release is right ot left
    const lock1 = new Mutex();
    const lock2 = new Mutex();
    const acquireOrder: Array<Mutex> = [];
    const releaseOrder: Array<Mutex> = [];
    const g3 = withG(
      [
        async () => {
          const release = await lock1.acquire();
          acquireOrder.push(lock1);
          return [
            async () => {
              releaseOrder.push(lock1);
              release();
            },
            lock1,
          ];
        },
        async () => {
          const release = await lock2.acquire();
          acquireOrder.push(lock2);
          return [
            async () => {
              releaseOrder.push(lock2);
              release();
            },
            lock2,
          ];
        },
      ],
      async function* ([l1, l2]) {
        expect(l1.isLocked()).toBe(true);
        expect(l2.isLocked()).toBe(true);
        yield 'first';
        yield 'second';
        return 'last';
      },
    );
    expect(await g3.next()).toStrictEqual({ value: 'first', done: false });
    expect(lock1.isLocked()).toBe(true);
    expect(lock2.isLocked()).toBe(true);
    expect(await g3.next()).toStrictEqual({ value: 'second', done: false });
    expect(lock1.isLocked()).toBe(true);
    expect(lock2.isLocked()).toBe(true);
    expect(await g3.next()).toStrictEqual({ value: 'last', done: true });
    expect(lock1.isLocked()).toBe(false);
    expect(lock2.isLocked()).toBe(false);
    expect(acquireOrder).toStrictEqual([lock1, lock2]);
    expect(releaseOrder).toStrictEqual([lock2, lock1]);
  });
  test('withF parameterised resources', async () => {
    await withF(
      [
        async () => [async () => {}, 1],
        async ([a]) => [async () => {}, a + 1],
        async ([, b]) => [async () => {}, b + 1],
      ],
      async ([a, b, c]) => {
        expect(a).toBe(1);
        expect(b).toBe(2);
        expect(c).toBe(3);
      },
    );
  });
  test('withG parameterised resources', async () => {
    const g = withG(
      [
        async () => [async () => {}, 1],
        async ([a]) => [async () => {}, a + 1],
        async ([, b]) => [async () => {}, b + 1],
      ],
      async function* ([a, b, c]): AsyncGenerator<number> {
        yield a;
        yield b;
        yield c;
      },
    );
    let counter = 1;
    for await (const r of g) {
      expect(r).toBe(counter);
      counter++;
    }
  });
});
