import type {
  ResourceAcquisitions,
  ResourceContext,
  SynchronousResourceAcquisitions,
} from '../types.js';
import type {
  ResourceAcquisitionKindCheck,
  ResourceCallerArgs,
  ResourceFunctionCheck,
  ResourceKind,
  ResourceKindCheck,
  ResourcefulOptions,
} from './types.js';
import { ResourceOwningAsyncGenerator } from '@matrixai/contexts';
import { ResourceOwner } from '../ResourceOwner.js';
import { ResourceOwningGenerator } from '../ResourceOwningGenerator.js';
import { SynchronousResourceOwner } from '../SynchronousResourceOwner.js';
import { withF } from '../utils.js';

/** Obtain a context's injected inventory without claiming that it is still valid. */
function requireResources<Resources extends readonly unknown[]>(context: {
  readonly resources?: Resources;
}): Resources {
  if (!Array.isArray(context.resources)) {
    throw new TypeError('The context does not contain a resource inventory');
  }
  return context.resources;
}

/** Reconstruct contexts records with the same data-descriptor policy as contexts. */
function descriptors(value: unknown): Map<PropertyKey, PropertyDescriptor> {
  if (value == null || typeof value !== 'object') {
    throw new TypeError('A resource context must be an ordinary data record');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError('A resource context must be an ordinary data record');
  }
  const result = new Map<PropertyKey, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor == null || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('A resource context must contain own data fields');
    }
    result.set(key, descriptor);
  }
  return result;
}

function projectContext(
  context: object,
  resources: readonly unknown[],
): object {
  const entries = descriptors(context);
  entries.set('resources', {
    value: resources,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const projected = {};
  for (const [key, descriptor] of entries) {
    Object.defineProperty(
      projected,
      key,
      descriptor.enumerable
        ? {
            value: descriptor.value,
            enumerable: true,
            writable: true,
            configurable: true,
          }
        : descriptor,
    );
  }
  return projected;
}

/** Preserve the selected return protocol while supplying invocation-local resources. */
function resourceful<
  This,
  Args extends unknown[],
  Result,
  const Acquisitions extends ResourceAcquisitions,
  const Position extends number | 'last',
  const Kind extends ResourceKind,
>(
  operation: ((this: This, ...args: Args) => Result) &
    ResourceFunctionCheck<NoInfer<Args>, Position, NoInfer<Acquisitions>> &
    ResourceKindCheck<NoInfer<Result>, Kind>,
  options: ResourcefulOptions<
    Position,
    Kind,
    Acquisitions,
    NoInfer<This>,
    NoInfer<Args>
  > &
    ResourceAcquisitionKindCheck<Acquisitions, Kind>,
): (this: This, ...args: ResourceCallerArgs<Args, Position>) => Result {
  const position = options.context as number | 'last';
  const kind = options.kind as ResourceKind;
  if (
    position !== 'last' &&
    (!Number.isSafeInteger(position) || position < 0)
  ) {
    throw new TypeError(
      'Context position must be last or a nonnegative integer',
    );
  }
  if (!['sync', 'async', 'generator', 'async-generator'].includes(kind)) {
    throw new TypeError('Unsupported resource protocol');
  }
  function wrapped(this: This, ...args: Args): Result {
    const receiver = this;
    const index = typeof position === 'number' ? position : args.length - 1;
    if (index < 0 || index >= args.length) {
      throw new RangeError('The selected context argument is missing');
    }
    let outer!: object;
    let entryContext!: ResourceContext;
    const select = (): {
      acquisitions: ResourceAcquisitions;
      context: ResourceContext;
    } => {
      outer = args[index] as object;
      const fields = descriptors(outer);
      const selected =
        typeof options.acquisitions === 'function'
          ? options.acquisitions.apply(receiver, args)
          : options.acquisitions;
      if (!Array.isArray(selected)) {
        throw new TypeError('Resource acquisitions must be an array');
      }
      entryContext = {
        signal: fields.get('signal')?.value as AbortSignal | undefined,
      };
      return { acquisitions: [...selected], context: entryContext };
    };
    const invoke = (resources: readonly unknown[]): Result => {
      entryContext.signal?.throwIfAborted();
      const forwarded: unknown[] = [...args];
      forwarded[index] = projectContext(outer, resources);
      return operation.apply(receiver, forwarded as Args);
    };
    if (kind === 'sync') {
      const selected = select();
      return withF(
        selected.acquisitions as SynchronousResourceAcquisitions,
        invoke as (resources: readonly unknown[]) => unknown,
        { ...selected.context, kind: 'sync' },
      ) as Result;
    }
    if (kind === 'async') {
      return Promise.resolve().then(() => {
        const selected = select();
        return withF(selected.acquisitions, invoke, selected.context);
      }) as Result;
    }
    if (kind === 'generator') {
      return new ResourceOwningGenerator(
        () => {
          const selected = select();
          return SynchronousResourceOwner.acquire(
            selected.acquisitions as SynchronousResourceAcquisitions,
            selected.context,
          );
        },
        (resources) =>
          invoke(resources) as Generator<unknown, unknown, unknown>,
      ) as Result;
    }
    return new ResourceOwningAsyncGenerator(
      () => {
        const selected = select();
        return ResourceOwner.acquire(selected.acquisitions, selected.context);
      },
      (owner) =>
        invoke(owner.resources) as AsyncGenerator<unknown, unknown, unknown>,
      (owner, exit) => owner.release(exit),
    ) as Result;
  }
  Object.defineProperty(wrapped, 'name', {
    value: operation.name,
    configurable: true,
  });
  return wrapped as unknown as (
    this: This,
    ...args: ResourceCallerArgs<Args, Position>
  ) => Result;
}

export { requireResources, resourceful };
