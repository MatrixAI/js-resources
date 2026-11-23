import type { ContextGeneratorExit } from '@matrixai/contexts';
import {
  assertSynchronous,
  SynchronousResourceOwner,
} from './SynchronousResourceOwner.js';

/** Keeps synchronous ownership across caller-driven generator advancement. */
class ResourceOwningGenerator<
  Inventory extends readonly unknown[],
  Yield,
  Result,
  Next = unknown,
> implements Generator<Yield, Result, Next> {
  private started = false;
  private closed = false;
  private closing = false;
  private busy = false;
  private owner!: SynchronousResourceOwner<Inventory>;
  private source!: Generator<Yield, Result, Next>;

  public constructor(
    private readonly acquire: () => SynchronousResourceOwner<Inventory>,
    private readonly body: (
      resources: Inventory,
    ) => Generator<Yield, Result, Next>,
  ) {}

  public next(...args: [] | [Next]): IteratorResult<Yield, Result> {
    return this.advance('next', args[0]);
  }

  public return(value: Result): IteratorResult<Yield, Result> {
    return this.advance('return', value);
  }

  public throw(reason: unknown): IteratorResult<Yield, Result> {
    return this.advance('throw', reason);
  }

  public [Symbol.iterator](): Generator<Yield, Result, Next> {
    return this;
  }

  public [Symbol.dispose](): void {
    if (!this.advance('return', undefined).done) {
      throw new TypeError(
        'Generator cleanup yielded; explicit advancement is required',
      );
    }
  }

  private advance(
    method: 'next' | 'return' | 'throw',
    input?: unknown,
  ): IteratorResult<Yield, Result> {
    if (this.busy) {
      throw new TypeError('Overlapping generator operations are not supported');
    }
    this.busy = true;
    try {
      if (this.closed || (!this.started && method !== 'next')) {
        this.closed = true;
        if (method === 'throw') throw input;
        return {
          done: true,
          value: (method === 'return' ? input : undefined) as Result,
        };
      }
      if (!this.started) {
        this.started = true;
        try {
          this.owner = this.acquire();
        } catch (reason) {
          this.closed = true;
          throw reason;
        }
        try {
          this.source = this.body(this.owner.resources);
          assertSynchronous(this.source, 'Generator creation');
        } catch (reason) {
          this.closed = true;
          const exit: ContextGeneratorExit<never> = {
            status: 'rejected',
            reason,
            kind: 'failed',
          };
          return SynchronousResourceOwner.complete(this.owner, exit);
        }
      }
      let result: IteratorResult<Yield, Result>;
      try {
        if (method === 'return') this.closing = true;
        result =
          method === 'next'
            ? this.source.next(input as Next)
            : method === 'return'
              ? this.source.return(input as Result)
              : this.source.throw(input);
        assertSynchronous(result, 'Generator advancement');
      } catch (reason) {
        this.closed = true;
        const exit: ContextGeneratorExit<never> = {
          status: 'rejected',
          reason,
          kind: 'failed',
        };
        return SynchronousResourceOwner.complete(this.owner, exit);
      }
      if (!result.done) return result;
      this.closed = true;
      const exit: ContextGeneratorExit<Result> = {
        status: 'fulfilled',
        value: result.value,
        kind: this.closing ? 'closed' : 'exhausted',
      };
      return {
        done: true,
        value: SynchronousResourceOwner.complete(this.owner, exit),
      };
    } finally {
      this.busy = false;
    }
  }
}

export { ResourceOwningGenerator };
