# Who we've met waits for the meeting reads

## Evidence

On an account cockpit, Who we've met draws three reads: coverage, the latest meetings, and the challenge rollup. Coverage can settle with nobody counted before the meeting list returns. The card then said "No meetings recorded for this account yet" and pointed at connecting Métis or ABC. A failed meeting list used that same sentence. Beside a map that already had people, a challenge read still loading or failed said "No challenges captured yet." A later coverage failure replaced the map with "Couldn't load meeting coverage" and hid the challenges and meetings already on screen.

## Correction

Empty-account and empty-challenge sentences are said only after that read succeeds. A loading read and a failed read say so, and Retry repeats the same read. A record already on screen stays if a later refresh fails. A missing meetings:read (403) still hides the card.

## Verification

`WhoWeMetCard.read.test.tsx`, `Meetings.test.tsx`, and `meeting-challenge-caption.test.ts`.
