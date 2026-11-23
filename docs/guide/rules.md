# Rules explained

All rules are evaluated at every **accepted** check-in, in this order: scavenger hunt →
required → forbidden → reward → travel. One check-in can trigger several rules.

## Required check-in

- The first deadline is *lock start + interval*.
- A check-in inside one of the required zones (or anywhere, if no zone is selected) is **valid**:
  the next deadline becomes *now + interval*, and the *successful check-in* consequences run.
- A check-in **outside** the required zones runs the *outside* consequences. It does **not** reset the deadline.
- If no valid check-in happens until *deadline + grace period*, the *missed* consequences run
  automatically (the server checks every 5 minutes). The next deadline is then *old deadline + interval*,
  so every further missed interval is penalised again (at most 10 at once).
- **Quiet hours**: a deadline falling inside the quiet window is moved to its end. Example: interval 4 h,
  last check-in 21:00, quiet 23:00–07:00 → next deadline 07:00.

## Forbidden zones

A check-in inside a forbidden zone runs its consequences. Within the **cooldown** the same zone is not
penalised again. Because GPS Lock only knows your position at check-in time, forbidden zones
are best combined with a required check-in *anywhere*.

## Reward zones

A check-in inside a reward zone runs the reward. Limits: a **cooldown per zone** and a **maximum number
of rewards per day** (all reward zones together, counted in the lock's timezone).

## Travel goals

The straight-line distance between two accepted check-ins (or background updates) is added up.

| Setting | Meaning |
|---|---|
| **Step size** | How many km earn **one** reward. Every full step runs the consequences once; leftover distance carries over. |
| **Max per check-in** | How many km a **single** check-in may add at most – so one big jump (train, car, cheating) can't collect many rewards at once. |
| **Daily cap** | How many km count per day in total (lock timezone). |

Example with step size **1 km** and max per check-in **3 km**:

- Moved 2.5 km between two check-ins → 2.5 km counted → **2 rewards**, 0.5 km carried over.
- Took a 40 km train ride → only **3 km** counted → **3 rewards**, not 40.

Time amounts are multiplied by the number of steps. Movements flagged as implausible never count.

## Scavenger hunt

- Checkpoints must be found **in order**. Only the current checkpoint matters.
- Being inside the current checkpoint during *any* check-in completes it (and runs *each checkpoint*).
  After the last one the hunt is **completed** (*hunt completed* consequences).
- A **hunt guess** (the *Submit hunt guess here* button) at the wrong place is a **wrong turn**
  (*wrong turn* consequences, at most once per cooldown).
- **Reveal** setting: *hint* – only the text; *distance* – after a guess you see a band
  (< 200 m, < 500 m, < 1 km, < 5 km, > 5 km); *map* – the next checkpoint is shown on the map.
- Optional **time limit**: when exceeded, the hunt fails and the *time limit* consequences run once.
- Optional **block unlocking**: the lock cannot be unlocked until the hunt is completed (or failed).

## Curfew

Requires [background tracking](./background-tracking). Between *start* and *end* (lock timezone, may cross midnight) every
location outside the curfew zones applies the consequences, at most once per cooldown. Being near the edge of the zone
doesn't count as outside until you are clearly outside.

## Background tracking

See [Background tracking](./background-tracking). In short: background locations are evaluated like check-ins, forbidden
zones count after a short confirmation time, reward zones can require a minimum stay, and a missing signal is penalised like a missed check-in.

With **live tracking only** the keyholder disables manual check-ins: only background locations count, the required check-in is
fulfilled by being in the zone, and hunt checkpoints are found by walking into them.

## Required check-ins and unlocking

While a required check-in is overdue, GPS Lock also tells Chaster to block unlocking until the next valid check-in.
