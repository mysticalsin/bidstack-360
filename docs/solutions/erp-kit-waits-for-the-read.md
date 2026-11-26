# ERP kit waits for the read

## Evidence

`ErpConnectorCard` treated a missing status payload as ERP left unset. A paused
first read has `isLoading` false and no status, so the card said to set
`ERP_MCP_URL` and badged the operating kit `local`. An in-flight status read
kept that local badge under the skeleton. A failed status read kept it too.
After status said ERP was configured, a kit read that had not arrived used the
same `local` badge.

## Correction

`erpPayloadPhase` reports unread, failed, or ready. Unread status says the
status has not arrived and does not mount the kit. A failed status says it has
not arrived and does not badge the kit local. A settled unset status still says
to set `ERP_MCP_URL` and still badges the kit local. A kit read that has not
arrived says the kit has not arrived. A failed kit says it could not load. A
loaded sidecar kit still shows. A settled lookup with source `none` still says
none.

## Verification

`ErpConnectorCard.unread.test.tsx`. The paused, in-flight, and failed cases
failed before the phase check.
