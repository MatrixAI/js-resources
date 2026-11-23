import type {
  ContextBodyExit,
  ContextCancellation,
  ContextScope,
} from '@matrixai/contexts';

/** Cancellation is cooperative and does not itself complete represented work. */
type ResourceContext = Partial<ContextCancellation>;

/** The owner reports the original outcome before attempting any releases. */
type ResourceRelease = (
  exit: ContextBodyExit<unknown>,
) => void | PromiseLike<void>;

type SynchronousResourceRelease = (exit: ContextBodyExit<unknown>) => void;

/** A successfully acquired resource and its mandatory release obligation. */
type ResourceLease<Resource> = {
  readonly resource: Resource;
  readonly release: ResourceRelease;
};

type SynchronousResourceLease<Resource> = {
  readonly resource: Resource;
  readonly release: SynchronousResourceRelease;
};

/** An acquisition sees an immutable snapshot of all earlier resources. */
type ResourceAcquire<
  Resource,
  Previous extends readonly unknown[] = readonly unknown[],
> = (
  resources: Previous,
  context: ResourceContext,
) => ResourceLease<Resource> | PromiseLike<ResourceLease<Resource>>;

type SynchronousResourceAcquire<
  Resource,
  Previous extends readonly unknown[] = readonly unknown[],
> = (
  resources: Previous,
  context: ResourceContext,
) => SynchronousResourceLease<Resource>;

/** Direct lists preserve tuple result inference; dependency annotations are trusted. */
type ResourceAcquisitions = readonly ResourceAcquire<unknown, any>[];
type SynchronousResourceAcquisitions = readonly SynchronousResourceAcquire<
  unknown,
  any
>[];

/** Reject async acquisition and release functions even under TypeScript's void rule. */
type SynchronousAcquisitionCheck<A extends SynchronousResourceAcquisitions> = {
  readonly [K in keyof A]: [
    Extract<ReturnType<A[K]>, PromiseLike<unknown>>,
  ] extends [never]
    ? [
        Extract<ReturnType<ReturnType<A[K]>['release']>, PromiseLike<unknown>>,
      ] extends [never]
      ? A[K]
      : never
    : never;
};

type Resources<Acquisitions extends ResourceAcquisitions> = {
  readonly [Key in keyof Acquisitions]: Awaited<
    ReturnType<Acquisitions[Key]>
  > extends ResourceLease<infer Resource>
    ? Resource
    : never;
};

type ResourceScopeContext<Resources extends readonly unknown[]> = {
  readonly resources: Resources;
};

type ResourceScope<Resources extends readonly unknown[]> = ContextScope<
  ResourceContext,
  ResourceScopeContext<Resources>
>;

export type {
  ResourceAcquire,
  ResourceAcquisitions,
  ResourceContext,
  ResourceLease,
  ResourceRelease,
  ResourceScope,
  ResourceScopeContext,
  Resources,
  SynchronousAcquisitionCheck,
  SynchronousResourceAcquire,
  SynchronousResourceAcquisitions,
  SynchronousResourceLease,
  SynchronousResourceRelease,
};
