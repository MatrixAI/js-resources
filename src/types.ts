type ResourceAcquire<Resource> = (
  resources: readonly any[],
) => Promise<readonly [ResourceRelease, Resource?]>;

type ResourceRelease = (e?: Error) => Promise<void>;

type Resources<T extends readonly ResourceAcquire<unknown>[]> = {
  [K in keyof T]: T[K] extends ResourceAcquire<infer R> ? R : never;
};

export type { ResourceAcquire, ResourceRelease, Resources };
