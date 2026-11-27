# Pipeline by industry is not a euro total

The opportunities list prices a bid as an amount with no recorded currency. Pipeline by industry sits on that page and was sending the same `value_micros` sum through the euro converter. On the demo door the open book is Siemens, IKEA, Sanofi, and HSBC (6.2 million). Stellantis and Spotify are closed and are not in the total. That 6.2 million was shown as euros, and a display currency other than euros would have changed the figure.

The panel prints the micros divided by 1e6, with the same basis line as the list: currency not recorded, and not a euro forecast. It does not convert.
