# Rules explained

Every zone has a **role**: *required* and/or *reward*, **or** *forbidden*, **or** *neutral* (no role). The role decides which
rule a zone belongs to; each rule has its own tab with settings for the whole rule and, per zone, settings that override them.

All rules are evaluated at every **accepted** check-in or background update, in this order: scavenger hunt → required →
"must stay inside" windows → forbidden → reward → travel. One location can trigger several rules. The server also runs every
minute for time-based things (deadlines, warnings, forbidden-zone penalties while you stay inside).

## Required zones

- **Each required zone has its own deadline** ("Home every 4 h **and** Work every 8 h"). A check-in at Home doesn't reset Work.
  The interval and grace period can be set per zone; otherwise the rule defaults apply (interval 4 h, grace **5 min**).
- **Shortest interval:** **5 min** with manual check-ins; **3 min** when background locations count as check-ins. With short
  intervals Lockation asks OwnTracks to report every half interval, at most every **2 min** (Move mode) – this uses more battery.
- Optional **check-in anywhere**: an extra deadline that doesn't depend on a zone – the wearer must check in somewhere at
  least once per interval, so their position is known regularly (useful together with forbidden zones). With background
  tracking every location counts.
- The first deadline is *lock start + interval*. A check-in inside the zone resets it to *now + interval* and runs
  *successful check-in* (rule list + the zone's extra list).
- A manual check-in **outside all required zones** runs *outside a zone* once. It doesn't reset any deadline.
- If no valid check-in happens until *deadline + grace*, *missed* runs (rule list + the zone's extra list). The next
  deadline is *old deadline + interval*, so every further missed interval is penalised again (at most 10 at once).
  Like forbidden-zone penalties, each *missed* consequence can be scheduled *every time / every n-th / only the n-th time*
  (also for the missing-signal list).
- **Quiet hours** move a deadline that falls inside them to their end (interval 4 h, last check-in 21:00, quiet 23:00–07:00 → 07:00).
- Optional **warning** N minutes before a deadline (with [notifications](./notifications)).
- While a deadline is overdue, Lockation blocks unlocking until the next valid check-in.
- Older locks whose required zones shared one deadline ("any of them") keep that behaviour.

### "Must stay inside" windows

A required zone can have **windows** (e.g. 22:00–06:00, optionally only on certain weekdays; a window may cross midnight and
belongs to the day it starts). During a window every location **outside** all required zones whose window is active applies
*outside during a window* (at most once per cooldown). Being in *any* of those zones is enough – e.g. "Home or Partner's
place 22:00–06:00". Needs [background tracking](./background-tracking). This replaces the former *curfew*.

## Forbidden zones

With background tracking, a stay in a forbidden zone follows a **timeline** (defaults, adjustable per zone):

```
0 min   you enter the zone
2 min   ⚠ warning: "leave within 8 min or: +1 h"
10 min  ❌ 1st penalty
11 min  ⚠ warning: "next penalty in 4 min"
15 min  ❌ 2nd penalty   … then every 5 min, with a warning 1 min after each penalty
```

- Warnings can be switched off; they need [notifications](./notifications) and are also written to the lock history.
- You only count as having left once you're **clearly** outside (accuracy included). Leaving and coming back within 5 min
  continues the timeline instead of starting at 0.
- A visit only noticed afterwards (e.g. delayed locations) gets the penalties of the time you were provably inside.
- Each penalty applies the rule's list plus the zone's **extra punishment**. Every consequence can be scheduled: *every time*,
  *every n-th time* (e.g. pillory at the 3rd, 6th … penalty) or *only the n-th time* (e.g. freeze at the 4th).
- **Time windows**: a zone can be forbidden only at certain times (e.g. *Bar* 20:00–02:00). If you are already inside when the
  window starts, the timeline starts at the window start.
- **Without background tracking** a check-in inside a forbidden zone is penalised immediately, at most once every 5 min.

## Reward zones

Being in a reward zone runs the reward (rule list + the zone's extra reward). Per zone you can set the **cooldown**, a **maximum
per day** and a **minimum stay** (with background tracking, e.g. 45 min at the gym). The rule's *maximum per day* is an overall
cap across all reward zones (lock timezone).

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

- **Random route**: the checkpoints are only *possible* checkpoints. When the hunt starts, Lockation draws between *at least*
  and *at most* of them (e.g. 2–4) in random order. Nobody knows the route in advance – not even the author of a self-lock.
  Only drawn checkpoints are shown, synced to OwnTracks and counted.
- **Order**: *in order* (default) – only the current checkpoint counts; or *any order* – every unfound checkpoint counts and the
  hunt is completed when all are found.
- Being inside a checkpoint at any check-in or background update completes it (*each checkpoint*). After the last one the hunt
  is **completed** (*hunt completed*).
- **Reveal**:
  - *Hint + pin all on the map* (default) – all checkpoints are shown with their hints and status (found / current / upcoming).
    There are **no wrong guesses** in this mode.
  - *Hint + pin current on the map* – only the current checkpoint (any order: all open ones).
  - *Hint + hot/cold distance* – after a guess you see a band (< 200 m … > 5 km).
  - *Hint only*.
- **Hunt guess** (*Submit hunt guess here*, not in "pin all" mode): a guess at the wrong place is a **wrong turn**
  (*wrong turn* consequences, at most once per cooldown).
- With background tracking, the checkpoints you can see are synced to OwnTracks, so reaching one is reported immediately.
- Optional **time limit** (hunt fails, *time limit* runs once) and **block unlocking** until completed.
- **Start**: automatically with the lock (default), by the **wearer** (*Start hunt* button), by the **keyholder**, or at a
  **scheduled time** (date/time or minutes after the lock start). Before the start, checkpoints are hidden and don't count.
  The keyholder can always start the hunt early (*Start now*).
- **Pause / resume**: *nobody*, *keyholder only* (default) or *wearer and keyholder*. While paused the time limit stops and
  checkpoints don't count; the paused time is added to the time limit.
- **Ending early**: the keyholder can always end the hunt – without consequences. If allowed, the wearer can **give up** – the
  hunt counts as failed and *wearer gives up* runs (e.g. add 1 day). Unlocking is no longer blocked by the hunt afterwards.
- The other side is notified when someone starts, pauses, resumes or ends the hunt.

## Surprise missions

"🎯 Be at the café by 14:30!" – the wearer has to reach a zone in time.

- **Targets:** the zones you tick in the 🎯 **Missions** tab (default: all). **Forbidden zones are never mission targets.**
  Random missions skip the zone the wearer is in and zones closer than the *minimum distance*.
- **Random missions:** on average every *n* minutes (±50 %, so nobody can predict them), only between the *from / until* times
  (lock time zone). They work on self-locks too.
- **Sent by the keyholder:** pick a zone and the minutes on the main page; the keyholder can also cancel a running mission.
- **Arrival** counts by check-in or background location inside the zone before the deadline → *arrived in time*.
  Otherwise *too late* applies (with background tracking, a location taken in time still counts if it arrives up to 5 minutes later).
- **Safety:** the wearer can decline a mission ("can't right now") without penalty – by default once per day. The keyholder is told.
- The wearer gets a push notification for each mission and a reminder shortly before the end.

## Zone actions (enter / leave)

Every zone – whatever its role, neutral too – can run consequences **when entering** and/or **when leaving** it
(Zones tab → zone → *⚡ Actions on enter / leave*):

- *Leaving counts only after at least … minutes inside* – e.g. **Gym**: leaving after at least 45 min → **unfreeze**.
- *Cooldown* – minimum time between two runs of the same action.
- With background tracking the actions run as soon as the wearer is inside / clearly outside (accuracy taken into account);
  with manual check-ins only at the next check-in inside / outside.
- The stay is counted from the first to the last location inside, so for "leaving after 45 min" keep tracking running.

## Background tracking

See [Background tracking](./background-tracking): background locations are evaluated like check-ins, a missing signal is
penalised like a missed check-in (optionally not during quiet hours, with a warning before), and with **live tracking only**
manual check-ins are disabled. The *check-in mode* (Tracking tab) decides: **manual only**, **manual + background** (both
count for required zones) or **background only**.

## Changes during a lock

If the keyholder changes the rules while the lock is running, the changes apply immediately. Lockation writes a summary to the
lock history ("Zone *Casino* added; *Home* check-in interval 4 h → 2 h"), notifies the wearer, and shows a **Rules changed**
note on the check-in page until the wearer confirms it. Hidden hunt checkpoints are never revealed ("hunt checkpoints changed").
