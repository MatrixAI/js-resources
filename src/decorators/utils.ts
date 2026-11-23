import type { ResourceAcquisitions } from '../types.js';
import type {
  ResourceAcquisitionKindCheck,
  ResourceDecoratorCheck,
  ResourceFunctionCheck,
  ResourceKind,
  ResourceKindCheck,
  ResourcefulOptions,
} from '../functions/types.js';
import { resourceful as resourcefulFunction } from '../functions/index.js';

/** Standard method form of the same protocol-specific function wrapper. */
function resourceful<
  const Position extends number | 'last',
  const Kind extends ResourceKind,
  const Acquisitions extends ResourceAcquisitions,
  This = unknown,
  Args extends unknown[] = unknown[],
>(
  options: ResourcefulOptions<Position, Kind, Acquisitions, This, Args> &
    ResourceAcquisitionKindCheck<Acquisitions, Kind>,
) {
  return function decorate<MethodThis, MethodArgs extends unknown[], Result>(
    method: ((this: MethodThis, ...args: MethodArgs) => Result) &
      ResourceFunctionCheck<MethodArgs, Position, Acquisitions> &
      ResourceDecoratorCheck<MethodArgs, Position> &
      ResourceKindCheck<Result, Kind>,
    metadata: ClassMethodDecoratorContext<
      MethodThis,
      (this: MethodThis, ...args: MethodArgs) => Result
    >,
  ): (this: MethodThis, ...args: MethodArgs) => Result {
    if (metadata.kind !== 'method') {
      throw new TypeError(
        'resourceful supports standard method decorators only',
      );
    }
    const adapt = resourcefulFunction as unknown as (
      method: (this: MethodThis, ...args: MethodArgs) => Result,
      config: typeof options,
    ) => (this: MethodThis, ...args: MethodArgs) => Result;
    return adapt(method, options);
  };
}

export { resourceful };
