# Company edit draft follows the open account

## Problem

`/companies/:id` keeps the company page mounted when the id changes. A cached account skips the loading skeleton, so Edit details still showed the previous account. Save compared that draft with the open record and wrote the previous name, domain, country, and headcount onto the account on screen.

## Solution

The draft is stored against the account id. When the id changes, the form loads that account's fields and clears field errors. A refresh of the same account leaves a name the person already typed.

## Verification

`apps/web` `CompanyDetailsForm.test.tsx`.
