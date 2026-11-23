import type { ContextBodyExit } from '@matrixai/contexts';
import type {
  ResourceContext,
  Resources,
  SynchronousResourceAcquisitions,
  SynchronousResourceRelease,
} from './types.js';

/** Reject a thenable at a synchronous-only boundary; it may already be active. */
function assertSynchronous(value: unknown, phase: string): void {
  if (
    value != null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  ) {
    void Promise.resolve(value).catch(() => undefined);
    throw new TypeError(`${phase} must be synchronous`);
  }
}

/** Owns one synchronous invocation's inventory and release obligations. */
class SynchronousResourceOwner<Inventory extends readonly unknown[]> {
  private readonly values: Array<unknown> = [];
  private readonly releases: Array<SynchronousResourceRelease> = [];
  private released = false;

  private constructor() {}

  public static acquire<const A extends SynchronousResourceAcquisitions>(
    acquisitions: A,
    context: ResourceContext,
  ): SynchronousResourceOwner<Resources<A>> {
    const owner = new SynchronousResourceOwner<Resources<A>>();
    try {
      context.signal?.throwIfAborted();
      for (const acquire of acquisitions) {
        const lease = acquire(Object.freeze([...owner.values]), context);
        assertSynchronous(lease, 'Resource acquisition');
        const release = lease.release;
        owner.releases.push((exit) => release.call(lease, exit));
        owner.values.push(lease.resource);
        context.signal?.throwIfAborted();
      }
      return owner;
    } catch (reason) {
      return SynchronousResourceOwner.complete(owner, {
        status: 'rejected',
        reason,
      });
    }
  }

  public static complete<Result>(
    owner: SynchronousResourceOwner<readonly unknown[]>,
    exit: ContextBodyExit<Result>,
  ): Result {
    try {
      owner.release(exit);
    } catch (cleanup) {
      if (exit.status === 'rejected') {
        throw new SuppressedError(cleanup, exit.reason);
      }
      throw cleanup;
    }
    if (exit.status === 'rejected') throw exit.reason;
    return exit.value;
  }

  public get resources(): Inventory {
    return Object.freeze([...this.values]) as unknown as Inventory;
  }

  public release(exit: ContextBodyExit<unknown>): void {
    if (this.released) return;
    this.released = true;
    const errors: Array<unknown> = [];
    for (let index = this.releases.length - 1; index >= 0; index--) {
      try {
        const release = this.releases[index] as (
          exit: ContextBodyExit<unknown>,
        ) => unknown;
        assertSynchronous(release(exit), 'Resource release');
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Resource release failed');
    }
  }
}

export { assertSynchronous, SynchronousResourceOwner };
