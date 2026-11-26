# Key-account initiative board waits for the read

## Evidence

`KamInitiativeBoard` treated `isLoading` as the only unread state. An idle read and a paused read have `isLoading` false and no payload, so the board said "No initiatives yet". An in-flight read showed only the skeleton. A later failure with cards already in hand replaced the board with "Couldn't load initiatives".

## Correction

A read with no payload is unread, including idle, paused, and in-flight. The Initiatives heading stays and the board says "Checking the initiative board. It has not arrived." A failure with no payload stays "Couldn't load initiatives". A page that arrived empty still says "No initiatives yet". A card that arrived stays, including a later failure.
