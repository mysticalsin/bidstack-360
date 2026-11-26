# Cockpit opportunity link waits for the read

The account header asks for the customer's opportunities as soon as the cockpit opens. A paused read and an in-flight read both have `data === undefined` and `isLoading === false`. The header treated that as a settled zero: open pipeline `0`, `0 open deals`, and a Create opportunity button. A later failure kept a deal that was already on screen.

`opportunityLinkPhase` decides the status. An error wins. Undefined data is unread. Anything else, including a settled null, is ready. Unread says Checking linked opportunities and does not paint a zero or offer to create a deal. A failed read says Could not check linked opportunities and drops a stale deal. A settled empty list or a settled null stays an honest zero. A loaded deal stays, including a blank name and a value of zero.
