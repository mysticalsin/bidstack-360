# A finished palette label stays while the next word is one letter

The command palette fuzzy matcher returned no match when the query was longer than the label. On the demo book that drops CI Financial the moment the next word is a single letter, as in `CI Financial I`.

A finished label still matches when the only extra text is a separator plus one letter or digit. Two letters are a real token and have to occur in the label. A letter glued onto the label is the same word and does not match. A longer label that contains the whole query still scores higher than the prefix-only row.
