# Workspace search finds a person by the address on the row

Demo contacts and leads print a full address (`klaus.vogt.<namespace>@example.com`, `hannah.berg.<namespace>@example.com`). Workspace search matched only plaintext name, role, and company columns, so pasting that address returned no rows. `contains` on email or phone throws in the PII middleware and fails the request.

A query that is one full address (one `@`, a dot in the domain, no spaces) is an email equality beside the plaintext token match. A fragment, a phone, or a name stays off email and phone. The encryption middleware rewrites that equality to `emailHash`.
