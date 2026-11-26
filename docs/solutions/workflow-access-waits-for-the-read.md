# Workflow access waits for the read

## Evidence

`WorkflowsPage` treated a missing capabilities payload as a missing
`workflows:write` grant. A paused first read has no manifest, so Run, delete,
and the active toggle said you need workflows write access. New workflow was
hidden. An in-flight read did the same. A failed read used that denial too.

## Correction

`workflowAccessPhase` reports unread, failed, allowed, or denied. Unread says
the permission has not arrived. It does not say you need workflows write
access, and it does not offer Run or New workflow. A failed read says the
access check failed and still does not offer Run. A settled denial still says
you need workflows write access and still hides New workflow. A settled grant
still offers Run and New workflow. A loaded workflow still shows. A settled
empty catalog still says No workflows yet.

## Verification

`WorkflowsPage.access-read.test.tsx`. The paused, in-flight, failed, and empty
catalog cases failed before the phase check.
