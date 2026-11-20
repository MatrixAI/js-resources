import type { ContextFunctionCheck } from '@matrixai/contexts/functions/index.js';
import type {
  ResourceAcquisitions,
  Resources,
  SynchronousAcquisitionCheck,
  SynchronousResourceAcquisitions,
} from '../types.js';

type ResourceKind = 'sync' | 'async' | 'generator' | 'async-generator';

type ResourcefulOptions<
  Position extends number | 'last',
  Kind extends ResourceKind,
  Acquisitions extends ResourceAcquisitions,
  This,
  Args extends unknown[],
> = {
  readonly context: Position;
  readonly kind: Kind;
  readonly acquisitions:
    Acquisitions | ((this: This, ...args: Args) => Acquisitions);
};

type ContextAt<
  Args extends unknown[],
  Position extends number | 'last',
> = Position extends 'last'
  ? Args extends [...unknown[], infer Last]
    ? Last
    : never
  : Position extends number
    ? Args[Position]
    : never;

type IncompatibleContext<Context, Provided> = Context extends unknown
  ? Context extends object
    ? Context extends { readonly resources?: infer Existing }
      ? Provided extends NonNullable<Existing>
        ? never
        : Context
      : never
    : Context
  : never;

type RequiredResources<Context> = Context extends {
  readonly resources: unknown;
}
  ? Context
  : never;

type ResourceDecoratorCheck<
  Args extends unknown[],
  Position extends number | 'last',
> = [RequiredResources<ContextAt<Args, Position>>] extends [never]
  ? unknown
  : never;

type ResourceCallerContext<Context> = Context extends unknown
  ? Omit<Context, 'resources'>
  : never;

type ResourceCallerArgs<
  Args extends unknown[],
  Position extends number | 'last',
> = Position extends 'last'
  ? Args extends [...infer Prefix, infer Last]
    ? [...Prefix, ResourceCallerContext<Last>]
    : never
  : {
      [Key in keyof Args]: `${Key & (string | number)}` extends `${Position}`
        ? ResourceCallerContext<Args[Key]>
        : Args[Key];
    };

type ResourceFunctionCheck<
  Args extends unknown[],
  Position extends number | 'last',
  Acquisitions extends ResourceAcquisitions,
> = ContextFunctionCheck<Args, Position, ContextAt<Args, Position>> &
  ([
    IncompatibleContext<ContextAt<Args, Position>, Resources<Acquisitions>>,
  ] extends [never]
    ? unknown
    : never);

type ResourceKindCheck<Result, Kind extends ResourceKind> = [Result] extends [
  never,
]
  ? unknown
  : Kind extends 'sync'
    ? [
        Extract<
          Result,
          PromiseLike<unknown> | Iterator<unknown> | AsyncIterator<unknown>
        >,
      ] extends [never]
      ? unknown
      : never
    : Kind extends 'async'
      ? Result extends Promise<infer Value>
        ? [Promise<Value>] extends [Result]
          ? unknown
          : never
        : never
      : Kind extends 'generator'
        ? Result extends Generator<infer Yield, infer Return, infer Next>
          ? [Generator<Yield, Return, Next>] extends [Result]
            ? unknown
            : never
          : never
        : Result extends AsyncGenerator<infer Yield, infer Return, infer Next>
          ? [AsyncGenerator<Yield, Return, Next>] extends [Result]
            ? unknown
            : never
          : never;

type ResourceAcquisitionKindCheck<
  A extends ResourceAcquisitions,
  Kind extends ResourceKind,
> = Kind extends 'sync' | 'generator'
  ? A extends SynchronousResourceAcquisitions
    ? A extends SynchronousAcquisitionCheck<A>
      ? unknown
      : never
    : never
  : unknown;

export type {
  ResourceAcquisitionKindCheck,
  ResourceCallerArgs,
  ResourceDecoratorCheck,
  ResourceFunctionCheck,
  ResourceKind,
  ResourceKindCheck,
  ResourcefulOptions,
};
