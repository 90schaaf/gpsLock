# Configuring a lock

When you add **Lockation** to a lock (self-lock or shared lock), Chaster opens the Lockation
configuration page. Configure everything and press Chaster's **Save** button.

The configuration can be edited later while the lock is running (as far as Chaster allows the keyholder to edit extensions).

## 1. Zones 🗺

- **Tap the map** to add a zone, or **search an address** and pick a result.
- Drag the coloured handle to move a zone; change name and radius in the list.
- Radius: 20 m to 50 km. Choose at least **100–150 m** for places indoors – phone GPS is not exact; zones below 100 m show a hint. Small radii (20–80 m) suit outdoor spots such as hunt checkpoints.
- **Limit:** at most **20 places per lock** – zones and scavenger-hunt checkpoints together. The Zones and Hunt tabs show how many are used. (iPhones watch at most 20 places per app, so all of them can be synced to OwnTracks.)
- **Zone matching**:
  - *Lenient* (default): the position must be inside the zone.
  - *Strict*: the whole accuracy circle must be inside – fairer for forbidden zones, harder for required zones.
- **Timezone**: used for quiet hours and daily limits. It is set automatically from your browser.

A zone does nothing by itself – it gets its meaning from the rules below.

## 2. Rules

Each tab has an **enabled** switch. See [Rules explained](./rules) for the exact behaviour.

- ⏱ **Required** – pick the zones (none = anywhere), the interval, grace period and optional quiet hours.
- ⛔ **Forbidden** – pick the forbidden zones and a cooldown.
- 🏆 **Reward** – pick reward zones, cooldown and maximum rewards per day.
- 🚶 **Travel** – *step size* = km per reward; *max per check-in* = the most one check-in can add (stops a train ride from collecting many rewards); *daily cap* = km counted per day. The tab shows a worked example for your values; details in [Rules explained](./rules#travel-goals).
- 🧭 **Hunt** – switch to the Hunt tab and tap the map to place checkpoints **in order**. Give each a hint.
- 📡 **Tracking** – enable [background tracking](./background-tracking): how long without a signal counts as missing (and what happens), how long someone must be inside a forbidden zone before it counts, and whether background locations count as required check-ins. Tick **Live tracking only** to disable manual check-ins entirely – the wearer must then keep OwnTracks running. The **curfew** is also configured here.
- 🏆 **Reward → Minimum stay** – with tracking, require e.g. 45 minutes at the gym.

## 3. Consequences

Every rule has one or more consequence lists ("When a check-in is missed", "Reward", …).
Choose a type and press **Add**:

| Consequence | Notes |
|-------------|-------|
| ➕ Add time / ➖ Remove time | In minutes. Travel goals multiply this by the number of steps. |
| ❄️ Freeze | Optional duration – Lockation unfreezes automatically afterwards. Without a duration the lock stays frozen until an *Unfreeze* consequence (e.g. on the next successful check-in). |
| 🔥 Unfreeze | Great as "on successful check-in". |
| 🪵 Pillory | 5 minutes to 24 hours, with a reason. Requires the Pillory extension on the lock. |
| ✅ Assign task | Requires the Tasks extension on the lock. |
| 📷 Verification picture | Requires the Verification Picture extension. |
| 📝 Log only | Only writes a note into the lock history. |
| 🔌 Other extension command | Runs a command of another installed extension (experimental Chaster feature). |

::: info Other extensions
Chaster currently lets extensions control **Tasks**, **Penalties**, **Verification picture**
and **Hygiene opening**. *Find the key, Jigsaw puzzle, Reward store* and *Typing lines* do not
offer commands yet – as soon as they do, they will appear in the command list automatically.
:::

## 4. Anti-cheat 🛡

| Setting | Default | |
|---|---|---|
| Required accuracy | 100 m | Check-ins less precise than this are rejected (no consequences). |
| Max position age | 120 s | Rejects cached positions. |
| Max plausible speed | 200 km/h | Jumps faster than this are "implausible". |
| Implausible speed | Reject | Or *reject and penalise*, or *accept and request a verification picture*. |
| Verification picture | Never | Or with every check-in, or randomly with a probability. |
| Min time between check-ins | 60 s | |

## 5. Privacy 🔒

- **Zones only** (recommended): Lockation stores which zones the wearer was in – no coordinates.
- **Exact**: the keyholder can see each check-in on a map.

The wearer sees this before accepting the lock and can always switch to *zones only*. Read more in [Privacy & fairness](./privacy).

## Disclaimer ✅

Before the first save the keyholder must tick **"I have read the disclaimer and use Lockation at my own risk"** at the bottom of the
page. Without it, saving fails. The confirmation is stored with the lock's configuration; if the [disclaimer](./disclaimer) changes
materially, you are asked again.

## Example setups

**"Stay home tonight"** – Zone *Home* (150 m). Required check-in in *Home* every 2 h, grace 10 min,
quiet hours 00:00–07:00. Missed: add 2 h + freeze until next check-in. Success: unfreeze.

**"Gym motivation"** – Zone *Gym*. Reward zone, max 1 per day: remove 3 h.

**"Stay away from the bar"** – Required check-in *anywhere* every 3 h (missed: add 1 h) + forbidden zone *Bar*: add 4 h and pillory 1 h.

**"Always tracked"** – Background tracking with *Live tracking only*, missing signal after 2 h: add 2 h + freeze.
Required zone *Home* every 6 h (missed: add 1 h + freeze, success: unfreeze). Forbidden zone *Bar*.

**"City hunt"** – 5 checkpoints with hints, reveal *distance*, block unlocking until completed, each checkpoint removes 30 min, wrong guess adds 15 min, time limit 6 h (timeout: add 1 day).
