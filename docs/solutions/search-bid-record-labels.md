# Search names the bid records it returns

Workspace search returns proposals, RFP requirements, and references. The search page tabs and badges only named opportunities, leads, contacts, companies, tasks, and notes, so a demo proposal such as the Siemens technical proposal showed the machine key `proposal` or `rfp_requirement` and had no tab. The empty guidance still offered sales orders. That type is tolerated on the wire and nothing emits it. A tab with no rows said the query matched nothing while other types still had rows. The command palette drew the same hits in a group with no accessible name.

The page now has Proposals, Requirements, and References tabs and badges. An unknown type such as `sales_order` stays on All and is labeled Result. A typed tab with no rows says other matches are on All. The palette groups those three types as Proposals, Requirements, and References, with the short badges prop, req, and ref.
