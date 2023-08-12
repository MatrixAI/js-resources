import type { ResourceAcquire, ResourceRelease, Resources } from './types.js';

/**
 * Make sure to explicitly declare or cast `acquires` as a tuple using `[ResourceAcquire...]` or `as const`
 */
async function withF<
  ResourceAcquires extends
    | readonly [ResourceAcquire<unknown>]
    | readonly ResourceAcquire<unknown>[],
  T,
>(
  acquires: ResourceAcquires,
  f: (resources: Resources<ResourceAcquires>) => Promise<T>,
): Promise<T> {
  const releases: Array<ResourceRelease> = [];
  const resources: Array<unknown> = [];
  let e_: Error | undefined;
  try {
    for (const acquire of acquires) {
      const [release, resource] = await acquire(resources);
      releases.push(release);
      resources.push(resource);
    }
    return await f(resources as unknown as Resources<ResourceAcquires>);
  } catch (e) {
    e_ = e;
    throw e;
  } finally {
    releases.reverse();
    for (const release of releases) {
      await release(e_);
    }
  }
}

/**
 * Make sure to explicitly declare or cast `acquires` as a tuple using `[ResourceAcquire...]` or `as const`
 */
async function* withG<
  ResourceAcquires extends
    | readonly [ResourceAcquire<unknown>]
    | readonly ResourceAcquire<unknown>[],
  T = unknown,
  TReturn = any,
  TNext = unknown,
>(
  acquires: ResourceAcquires,
  g: (
    resources: Resources<ResourceAcquires>,
  ) => AsyncGenerator<T, TReturn, TNext>,
): AsyncGenerator<T, TReturn, TNext> {
  const releases: Array<ResourceRelease> = [];
  const resources: Array<unknown> = [];
  let e_: Error | undefined;
  try {
    for (const acquire of acquires) {
      const [release, resource] = await acquire(resources);
      releases.push(release);
      resources.push(resource);
    }
    return yield* g(resources as unknown as Resources<ResourceAcquires>);
  } catch (e) {
    e_ = e;
    throw e;
  } finally {
    releases.reverse();
    for (const release of releases) {
      await release(e_);
    }
  }
}

export { withF, withG };
