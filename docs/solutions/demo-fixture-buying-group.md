# Demo deals show the people already on the account

Fixture contacts are stored on the customer. Fixture deals for that customer have no `OpportunityContact` rows. The deal tab reads only those rows, so every seeded deal says "No linked contacts". A paused read has `isLoading` false and no payload, and that also said the buying group was empty.

`projectFixtureBuyingGroup` runs only when `POLO_DATA_MODE` is exactly `demo` or unset. It keeps live contacts whose customer matches the deal, and drops a contact whose company id conflicts. The top influence is the one primary: 5 is decision maker, 4 is champion, 3 is influencer, anything else is stakeholder. A blank customer stays empty. `real`, `Demo`, `DEMO`, and `demo-x` stay on the stored rows.

A stored link, including one a person removed, wins. The projection is not written on read. The first edit stores the projected rows, then applies that edit, so a removed person does not come back. The deal tab says "Checking the buying group." until the payload arrives, and "Could not load the buying group." when the read fails. A settled empty list stays empty.
