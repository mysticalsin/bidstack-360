# An expanded case study keeps its contact and tags

The reference library expanded a row by putting the customer contact in the company column and the tags in the industry column. Company hides below the `md` breakpoint, industry hides below `xl`, and both cells are nowrap inside a fixed width. The seeded contact "Michael Johnson · mjohnson@ci.com" and a four-tag list were clipped or missing. The description was the only field in the title column, which is the column that wraps and stays visible.

The expanded title cell now carries the description, the contact, and the tags. The company and industry detail cells stay empty so a clipped copy is not left behind. A case study with no contact, such as the seeded DNB Bank row, does not print a contact line.
