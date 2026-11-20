import type { ContextBodyExit } from '@matrixai/contexts';
import type {
  ResourceAcquisitions,
  ResourceContext,
  ResourceRelease,
  Resources,
} from './types.js';
import { bracketResource } from '@matrixai/contexts';

/** Owns one invocation's acquired inventory and its release obligations. */
class ResourceOwner<Inventory extends readonly unknown[]> {
  private readonly values: Array<unknown> = [];
  private readonly releases: Array<ResourceRelease> = [];
  private released = false;

  private constructor() {}

  public static acquire<const Acquisitions extends ResourceAcquisitions>(
    acquisitions: Acquisitions,
    context: ResourceContext,
  ): Promise<ResourceOwner<Resources<Acquisitions>>> {
    const owner = new ResourceOwner<Resources<Acquisitions>>();
    return bracketResource(
      () => owner,
      async () => {
        context.signal?.throwIfAborted();
        for (const acquire of acquisitions) {
          const lease = await acquire(
            Object.freeze([...owner.values]),
            context,
          );
          const release = lease.release;
          owner.releases.push((exit) => release.call(lease, exit));
          owner.values.push(lease.resource);
          context.signal?.throwIfAborted();
        }
        return owner;
      },
      (inventory, exit) =>
        exit.status === 'rejected' ? inventory.release(exit) : undefined,
    );
  }

  public get resources(): Inventory {
    return Object.freeze([...this.values]) as unknown as Inventory;
  }

  /** Attempts every known release once, in reverse acquisition order. */
  public async release(exit: ContextBodyExit<unknown>): Promise<void> {
    if (this.released) return;
    this.released = true;
    const errors: Array<unknown> = [];
    for (let index = this.releases.length - 1; index >= 0; index--) {
      try {
        const release = this.releases[index];
        await release(exit);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Resource release failed');
    }
  }
}

export { ResourceOwner };
