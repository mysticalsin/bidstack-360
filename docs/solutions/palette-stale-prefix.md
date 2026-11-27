# A command-palette server page belongs to the query that fetched it

Workspace search and opportunity search in the palette are debounced. Until that timer commits, the last page is still the previous prefix. Those rows were pinned at score 0 so a hidden-field hit could stay, which also kept the old page on screen after the next letter and after the box was cleared. An empty list in that window said "No matches." before the new search had started.

Show server rows only when the trimmed live query and the trimmed debounced query are the same term. A hidden-field hit on that settled page still stays. While a term of two or more characters is ahead of the debounce, an empty list says "Searching…". A cleared box is the browse list.
