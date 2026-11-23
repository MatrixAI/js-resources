import type {
  ResourceAcquisitions,
  ResourceContext,
  ResourceScope,
  ResourceScopeContext,
  Resources,
  SynchronousAcquisitionCheck,
  SynchronousResourceAcquisitions,
} from './types.js';
import type { ContextBodyExit } from '@matrixai/contexts';
import {
  bracketResource,
  createContextScope,
  ResourceOwningAsyncGenerator,
} from '@matrixai/contexts';
import { ResourceOwner } from './ResourceOwner.js';
import { ResourceOwningGenerator } from './ResourceOwningGenerator.js';
import {
  assertSynchronous,
  SynchronousResourceOwner,
} from './SynchronousResourceOwner.js';

/** A genuinely synchronous bracket for synchronously acquired resources. */
function withSyncF<
  const Acquisitions extends SynchronousResourceAcquisitions,
  Result,
>(
  acquisitions: Acquisitions & SynchronousAcquisitionCheck<Acquisitions>,
  body: ((resources: Resources<Acquisitions>) => Result) &
    ([Extract<Result, PromiseLike<unknown>>] extends [never] ? unknown : never),
  context: ResourceContext = {},
): Result {
  const selected = [...acquisitions] as unknown as Acquisitions;
  const owner = SynchronousResourceOwner.acquire(selected, context);
  let exit: ContextBodyExit<Result>;
  try {
    context.signal?.throwIfAborted();
    const value = body(owner.resources);
    assertSynchronous(value, 'Resource body');
    exit = Object.freeze({ status: 'fulfilled', value });
  } catch (reason) {
    exit = Object.freeze({ status: 'rejected', reason });
  }
  return SynchronousResourceOwner.complete(owner, exit);
}

/** Owns resources through the caller-driven lifetime of a synchronous generator. */
function withSyncG<
  const Acquisitions extends SynchronousResourceAcquisitions,
  Yield,
  Result,
  Next = unknown,
>(
  acquisitions: Acquisitions & SynchronousAcquisitionCheck<Acquisitions>,
  body: (resources: Resources<Acquisitions>) => Generator<Yield, Result, Next>,
  context: ResourceContext = {},
): Generator<Yield, Result, Next> {
  const selected = [...acquisitions] as unknown as Acquisitions;
  return new ResourceOwningGenerator(
    () => SynchronousResourceOwner.acquire(selected, context),
    (resources) => {
      context.signal?.throwIfAborted();
      return body(resources);
    },
  );
}

/** Runs the represented body and all mandatory releases before settling. */
function withF<
  const Acquisitions extends SynchronousResourceAcquisitions,
  Result,
>(
  acquisitions: Acquisitions & SynchronousAcquisitionCheck<Acquisitions>,
  body: ((resources: Resources<Acquisitions>) => Result) &
    ([Extract<Result, PromiseLike<unknown>>] extends [never] ? unknown : never),
  context: ResourceContext & { readonly kind: 'sync' },
): Result;
function withF<const Acquisitions extends ResourceAcquisitions, Result>(
  acquisitions: Acquisitions,
  body: (resources: Resources<Acquisitions>) => Result | PromiseLike<Result>,
  context?: ResourceContext & { readonly kind?: 'async' },
): Promise<Result>;
function withF(
  acquisitions: ResourceAcquisitions,
  body: (resources: any) => any,
  context: ResourceContext & { readonly kind?: 'sync' | 'async' } = {},
): any {
  if (context.kind === 'sync') {
    return withSyncF(
      acquisitions as SynchronousResourceAcquisitions,
      body as (resources: readonly unknown[]) => unknown,
      context,
    );
  }
  if (context.kind != null && context.kind !== 'async') {
    throw new TypeError('Unsupported function resource protocol');
  }
  const selected = [...acquisitions];
  return bracketResource(
    () => ResourceOwner.acquire(selected, context),
    (owner) => {
      context.signal?.throwIfAborted();
      return body(owner.resources);
    },
    (owner, exit) => owner.release(exit),
  );
}

/** Owns resources through the caller-driven lifetime of a lazy generator. */
function withG<
  const Acquisitions extends SynchronousResourceAcquisitions,
  Yield,
  Result,
  Next = unknown,
>(
  acquisitions: Acquisitions & SynchronousAcquisitionCheck<Acquisitions>,
  body: (resources: Resources<Acquisitions>) => Generator<Yield, Result, Next>,
  context: ResourceContext & { readonly kind: 'generator' },
): Generator<Yield, Result, Next>;
function withG<
  const Acquisitions extends ResourceAcquisitions,
  Yield,
  Result,
  Next = unknown,
>(
  acquisitions: Acquisitions,
  body: (
    resources: Resources<Acquisitions>,
  ) => AsyncGenerator<Yield, Result, Next> | Generator<Yield, Result, Next>,
  context?: ResourceContext & { readonly kind?: 'async-generator' },
): AsyncGenerator<Awaited<Yield>, Awaited<Result>, Next>;
function withG(
  acquisitions: ResourceAcquisitions,
  body: (
    resources: any,
  ) => Generator<any, any, any> | AsyncGenerator<any, any, any>,
  context: ResourceContext & {
    readonly kind?: 'generator' | 'async-generator';
  } = {},
): Generator<any, any, any> | AsyncGenerator<any, any, any> {
  if (context.kind === 'generator') {
    return withSyncG(
      acquisitions as SynchronousResourceAcquisitions,
      body as (resources: any) => Generator<any, any, any>,
      context,
    );
  }
  if (context.kind != null && context.kind !== 'async-generator') {
    throw new TypeError('Unsupported generator resource protocol');
  }
  const selected = [...acquisitions];
  return new ResourceOwningAsyncGenerator(
    () => ResourceOwner.acquire(selected, context),
    (owner) => {
      context.signal?.throwIfAborted();
      const source = body(owner.resources);
      return (async function* (): AsyncGenerator<any, any, any> {
        return yield* source;
      })();
    },
    (owner, exit) => owner.release(exit),
  );
}

/** Supplies the acquired inventory to a composed contexts operation. */
function createResourceScope<const Acquisitions extends ResourceAcquisitions>(
  acquisitions: Acquisitions,
): ResourceScope<Resources<Acquisitions>> {
  const selected = [...acquisitions] as unknown as Acquisitions;
  return createContextScope<
    ResourceContext,
    ResourceScopeContext<Resources<Acquisitions>>
  >((context, body) =>
    withF(selected, (resources) => body({ resources }), context),
  );
}

export { createResourceScope, withF, withG };
