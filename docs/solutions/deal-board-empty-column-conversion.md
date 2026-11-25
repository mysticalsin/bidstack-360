# An empty deal-board column is not a 100% conversion

**Problem:** The deal board prints a conversion chip on each open column: cards in later columns divided by cards in this column plus those later cards. Demo S1 Lead holds no bids. Every other open or won bid sits later, so the chip reads 100%. A continued page of 50 is not the book, and that chip still printed a percent beside "not every bid". A loss only dropped out when the stage was named Closed Lost.

**Fix:**

- An empty column has no rate.
- A page that continues has no rate.
- A won or lost column has no rate.
- A later loss, including a stage named Lost, is not progress. A later win still counts.
- A column that still holds bids keeps the snapshot rate.

**Why it works:** 100% of an empty lead column is not a conversion. The chip stays only when this column has bids and the board page is the whole loaded book.

**Validation:**

- `pnpm --filter @bidstack/web exec vitest run src/pages/pipelineBoard/pipeline-column-conversion.test.ts src/pages/PipelinePage.columnConversion.test.tsx src/pages/PipelinePage.test.tsx`
