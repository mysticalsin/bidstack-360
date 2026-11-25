# Needs you opens the overdue bid list

The workspace dashboard "Needs you" row counts open bids whose close day is before today's UTC day. The link is `/opportunities?due=overdue`, the same slice as the opportunities Overdue chip.

A bid due later today stays out of that count. A won or lost bid stays out. The overdue list can still include decided bids, because that filter is a date window, not an open-stage filter.
