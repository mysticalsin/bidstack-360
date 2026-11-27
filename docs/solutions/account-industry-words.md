# Key and top account industries are words

## Evidence

Demo companies store industry codes (`financial_services`, `healthcare`, `pharmaceuticals`). Strategic Accounts and Account Ranking printed the code on the badge, the filter, and the industry signal. Pressing pharmaceuticals, which has no pipeline, said that industry leads the view. An account with no industry was filtered by the word Unclassified.

## Correction

Those surfaces print `accountIndustryLabel`. The filter request still sends the stored code. A selected industry says "Filtered to …". The industry with the most pipeline is the one that leads, and only when no industry is selected. An empty industry clears the filter.
