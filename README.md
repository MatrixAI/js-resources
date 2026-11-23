# js-resources

Resource brackets for sequential, dependent acquisitions. The provider owns the
acquired resources until the represented body and mandatory releases finish. It
uses the released `@matrixai/contexts` ownership and scope primitives. This is
an optional policy layer, not a requirement for using contexts: a single
resource may be simpler to manage directly with a contexts bracket or native
resource management. This library standardizes list acquisition, rollback,
cancellation checks, cleanup, and failure reporting for callers that need them.

## Function and generator brackets

```typescript
import { withF, withG } from '@matrixai/resources';

const acquisitions = [
  async () => {
    const file = await openFile();
    return {
      resource: file,
      release: async () => file.close(),
    };
  },
] as const;

const size = await withF(acquisitions, async ([file]) => file.size());

for await (const chunk of withG(acquisitions, async function* ([file]) {
  yield await file.read();
})) {
  consume(chunk);
}
```

The examples use application-defined file operations. Acquisition functions are
invoked sequentially, with an immutable snapshot of the earlier resources and a
context containing an optional cancellation signal. Return a lease only after a
resource is acquired and its release obligation is known. A failed acquisition
must clean up any work it has not returned as a lease.

`withF` defaults to an asynchronous bracket and returns a promise. Select its
`sync` kind when acquisition, the body, and release are all synchronous; the
result then stays synchronous. `withG` defaults to an async generator and
accepts either kind of generator body. Select its `generator` kind for a
synchronous generator and synchronous acquisitions and releases.

Both generator forms acquire on the first `next`, hold resources across yields,
and release on terminal completion or explicit close. Closing before the first
`next` acquires nothing. Concurrent iterator operations are rejected. If close
or async disposal yields from generator cleanup, continue advancing the
generator until it completes. Abandonment is not detected and does not release
resources. Detached work is not included in either bracket's represented
lifetime.

## Dependent acquisitions and scopes

Each acquisition can use resources returned by preceding acquisitions:

```typescript
import { createResourceScope, withF } from '@matrixai/resources';

const acquisitions = [
  async () => ({ resource: 42, release: async () => {} }),
  async ([number]: readonly [number]) => ({
    resource: String(number),
    release: async () => {},
  }),
] as const;

const result = await withF(
  acquisitions,
  ([number, text]) => `${number}:${text}`,
);
const operation = createResourceScope(acquisitions)(
  async ({ resources }) => resources[1],
);
const text = await operation({});
```

Every invocation owns a separate inventory; acquisitions must synchronize any
shared external state. Lists infer the resulting resource tuple, but manually
annotated dependencies are trusted rather than checked against earlier entries.
The scope supplies a `resources` field through contexts record projection; a
nested resource scope shadows an outer field with the same name.

## Function wrappers and method decorators

The function and decorator entrypoints accept an explicit context argument
position, acquisition list or selector, and one of the `sync`, `async`,
`generator`, or `async-generator` protocols. They preserve the receiver and
ordinary arguments and use the same ownership boundaries as direct brackets.
Generators remain lazy; their acquisition selector runs on first advancement.

```typescript
import { requireResources } from '@matrixai/resources';
import { resourceful } from '@matrixai/resources/decorators';

type RequestContext = {
  requestId: string;
  resources?: readonly [number];
};

const acquisitions = [() => ({ resource: 7, release: () => {} })] as const;

class Service {
  @resourceful({ context: 1, kind: 'async', acquisitions })
  async read(id: string, context: RequestContext): Promise<string> {
    const [resource] = requireResources(context);
    return `${id}:${context.requestId}:${resource}`;
  }
}

const result = await new Service().read('item', { requestId: 'request' });
```

The selected context must be a required ordinary data-record argument. Standard
decorators cannot alter a method's declared call signature, so the injected
resource field is optional in that signature and the accessor checks its
presence. The accessor does not establish resource validity or ownership. A
standalone function wrapper can remove the supplied resource field from the
caller's required context type. Optional context positions, rest parameters,
overload preservation and extra promise or iterator capabilities are not
claimed.

## Failures and cancellation

Release callbacks receive the original body or acquisition exit, including an
arbitrary rejection value. Releases run in reverse order and every known release
is attempted, even if another fails. Cleanup failures are reported in an
`AggregateError` in attempted order. If both the represented work and cleanup
fail, a `SuppressedError` exposes the cleanup aggregate as `error` and the
original failure as `suppressed`. Attempting a release does not guarantee that
the underlying resource was released.

Cancellation is cooperative. The signal is checked before acquisition, after
each acquired lease, and before entering the body. An abort during acquisition
rolls back any leases that are eventually returned. An abort during the body
does not stop it or release its resources early; the body must cooperate and
settle. Cleanup is mandatory and is not skipped because the signal was aborted.
Synchronous contracts cannot wait for a thenable returned by an untyped caller.
Such a value is rejected, but may already have started work; its eventual
resource or cleanup cannot be guaranteed to finish within a synchronous call.

## Migration

This is a breaking revision of the earlier bracket API. Acquisitions now return
`{ resource, release }` leases instead of release/resource tuples. Release
callbacks receive a discriminated exit rather than an optional error. Code that
previously depended on the first cleanup failure stopping later releases must
handle the aggregate failure contract instead. The function and generator
entrypoints still accept an acquisition list directly.

## Development

Node.js 24 or newer is required. The Nix development environment supplies the
prepared, lock-selected contexts archive and the MatrixAI lint toolchain. The
normal build cleans before compiling, while local tests build incrementally.
Independent Nix checks use the prebuilt test mode and do not rely on the local
development environment. No browser-specific runtime behavior is required.
