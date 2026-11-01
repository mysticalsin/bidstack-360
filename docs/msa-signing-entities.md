# Signing entities (Mantu / Amaris)

Admin-editable list of **our** brands and branches that can appear as the
supplier on an MSA. Seeded per organisation from
`packages/shared/src/msa/signing-entities.catalog.ts`.

## Rules

- Public sources only: mantu.com, amaris.com, and a brand's own site.
- Every row has a `sourceUrl`.
- Anything not confirmed on that page is `unverified`.
- No real client documents and no personal data.

## Seeded rows

| Slug | Name | Family | Lines | Status | Source |
| --- | --- | --- | --- | --- | --- |
| mantu | Mantu | mantu | consulting, IT, engineering, digital | verified | https://www.mantu.com |
| amaris-consulting | Amaris Consulting | amaris | IT, engineering, digital, consulting, pharma | verified | https://www.amaris.com |
| hema | HEMA (Health Economics and Market Access) | amaris | health economics, market access, pharma | verified | https://www.amaris.com |
| amaris-life-sciences | Amaris Life Sciences | amaris | pharma, HEMA lines | unverified | https://www.amaris.com |
| azeo | Azeo | mantu | digital, IT | unverified | https://www.mantu.com |
| viveris | Viveris | mantu | engineering, IT | unverified | https://www.mantu.com |
| bluecoders | Bluecoders | mantu | IT, staffing | unverified | https://www.mantu.com |
| exlancer | Exlancer | mantu | IT, staffing | unverified | https://www.mantu.com |
| shakers | Shakers | mantu | staffing, digital | unverified | https://www.mantu.com |
| yield-studio | Yield Studio | mantu | product, digital | unverified | https://www.mantu.com |

## Unverified (needs a human pass)

Azeo, Viveris, Bluecoders, Exlancer, Shakers, Yield Studio, and Amaris Life
Sciences are listed from public group/brand pages. Legal names, exact branch
status, and whether they independently sign MSAs were not confirmed on the
source URL at seed time.

HEMA is required and treated as verified: it is the Amaris branch that signs
many pharmaceutical MSAs. Detection aliases include `HEMA`,
`Health Economics and Market Access`, `Health Economics & Market Access`,
and Amaris legal-entity names paired with HEMA.
