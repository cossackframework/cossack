import type { QueryResult } from "../adapter/types.js";
import { SQLFragment, type SQLNode } from "./fragment.js";

export class ExecutableFragment<Result> extends SQLFragment<Result> {
  constructor(
    nodes: readonly SQLNode[],
    private readonly executor: (fragment: SQLFragment<Result>) => Promise<QueryResult<Result>>,
  ) {
    super(nodes);
  }

  then<TResult1 = QueryResult<Result>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<Result>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.executor(this).then(onfulfilled, onrejected);
  }
}
