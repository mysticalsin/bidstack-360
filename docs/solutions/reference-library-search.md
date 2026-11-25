# The reference library search includes industry, tags, and company

`GET /references?search=` used to match only the title and the description. On the seeded library that missed the words the row is filed under. `healthcare` is the Rush industry and a tag. `governance` and `landing-zone` are DNB tags and are not in the title. `System for Health` is the company name on the Rush row, and the title is `Rush University — EHR cloud migration`.

The list filter now matches the title, the description, the industry, and the company name as a case-insensitive substring, and a tag when the query is that whole tag. A capitalized query is also tried in lowercase, so `Governance` finds the seeded `governance` tag. A blank query is not a filter. Contact name and email are not search fields. The industry and tag facet params are unchanged.
