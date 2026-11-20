import { expectTypeOf, test } from 'vitest';
import { withF, withG } from '@matrixai/resources';

test('resource inventories retain tuple types', () => {
  void withF(
    [
      () => ({ resource: 1, release: () => {} }),
      ([first]: readonly [number]) => ({
        resource: String(first),
        release: () => {},
      }),
    ] as const,
    (resources) => {
      expectTypeOf(resources).toEqualTypeOf<readonly [number, string]>();
      // @ts-expect-error The inventory is immutable.
      resources[0] = 1;
    },
  );
});

test('synchronous boundaries reject asynchronous acquisition, release and body', () => {
  const sync = [() => ({ resource: 1, release: () => {} })] as const;
  expectTypeOf(
    withF(sync, ([value]) => value, { kind: 'sync' }),
  ).toEqualTypeOf<number>();
  expectTypeOf(
    withG(
      sync,
      function* () {
        yield 1;
      },
      { kind: 'generator' },
    ).next(),
  ).toEqualTypeOf<IteratorResult<number, void>>();
  // @ts-expect-error A synchronous bracket cannot acquire asynchronously.
  void withF([async () => ({ resource: 1, release: () => {} })], () => 1, {
    kind: 'sync',
  });
  // @ts-expect-error A synchronous bracket cannot release asynchronously.
  void withF([() => ({ resource: 1, release: async () => {} })], () => 1, {
    kind: 'sync',
  });
  // @ts-expect-error A synchronous bracket cannot own an asynchronous body.
  void withF(sync, async () => 1, { kind: 'sync' });
});
