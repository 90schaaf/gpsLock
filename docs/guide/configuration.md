# Configuring a lock

When you add **Lockation** to a lock (self-lock or shared lock), Chaster opens the Lockation
configuration page. Configure everything and press Chaster's **Save** button.

The configuration can be edited later while the lock is running (as far as Chaster allows the keyholder to edit extensions).

## 1. Zones 🗺

- **Tap the map** to add a zone, or **search an address** and pick a result.
- Drag the coloured handle to move a zone; change name and radius in the list.
- Radius: 20 m to 50 km. Choose at least **100–150 m** for places indoors – phone GPS is not exact; zones below 100 m show a hint. Small radii (20–80 m) suit outdoor spots such as hunt checkpoints.
- **Limit:** at most **20 places per lock** – zones and scavenger-hunt checkpoints together. The Zones and Hunt tabs show how many are used. (iPhones watch at most 20 places per app, so all of them can be synced to OwnTracks.)
- **Role** of each zone: *Required* and/or *Reward*, **or** *Forbidden*, **or** *Neutral*. The rule tabs only list the zones
  with their role. Changing a role removes that zone's settings of the old role (you are asked first).
- **Zone matching** – per zone (or the lock default):
  - *Lenient* (default): the position must be inside the zone.
  - *Strict*: the whole accuracy circle must be inside – fairer for forbidden zones (suggested automatically for them), harder for required zones.
- **Safety check**: every zone and checkpoint is checked against OpenStreetMap (water, sea, glacier/cliff, military areas,
  runways/railways, no road or path nearby). Places flagged as *out of reach* are listed at the top of the page; **one**
  confirmation ("I know – these places are intentionally hard to reach") covers all of them. Moving a place checks it again.
  The wearer sees the confirmed note.
- **Timezone**: used for windows, quiet hours and daily limits. It is set automatically from your browser.

A zone does nothing by itself – it gets its meaning from its role and the rules below. Independent of the role, each zone can
run **actions on enter / leave** (e.g. unfreeze after leaving the gym) – see [Rules explained](./rules#zone-actions-enter-leave).

## 2. Rules

Problems are shown where they occur: a tab with problems is marked **⚠ n**, the problems are listed at the top of that tab
(e.g. *Bar › First warning: …*), affected fields are outlined in red, and the Save button area tells you which tabs need attention.

Each tab has an **enabled** switch and lists its zones; open a zone to override the rule values for it. See
[Rules explained](./rules) for the exact behaviour.

- ⏱ **Required** – check-in anywhere (optional), interval, grace period (default 5 min), quiet hours, warning before deadlines,
  consequences. Per zone: interval check-ins on/off, own interval/grace, **"must stay inside" windows** (former curfew; needs
  background tracking) and extra consequences.
- ⛔ **Forbidden** – the timeline (first warning, first penalty, repeat every, repeat warning) and the penalty. Per zone: time
  windows ("only during"), own timings and an **extra punishment**; each consequence can be scheduled *every time / every n-th /
  only the n-th*. The tab shows what a 1-hour stay would cost.
- 🏆 **Reward** – cooldown, overall maximum per day, minimum stay, reward. Per zone: own cooldown, maximum per day, minimum stay and an extra reward.
- 🚶 **Travel** – *step size* = km per reward; *max per check-in* = the most one check-in can add (stops a train ride from collecting many rewards); *daily cap* = km counted per day. The tab shows a worked example for your values; details in [Rules explained](./rules#travel-goals).
- 🧭 **Hunt** – tap the map to place checkpoints **in order** and give each a hint. Choose *in order* or *any order* and the
  reveal mode (default *hint + pin all on the map*, which has no wrong guesses). With **Random route** the checkpoints become
  a pool: at the start, *at least … at most …* of them are drawn in random order – hunts become possible on self-locks.
- 🎁 **Surprise** – the possible outcomes of each surprise zone (text, weight, consequences, optional hold: stay for a while or
  until the keyholder releases), once or every visit, and whether the wearer may see the possible outcomes.
- 🎯 **Missions** – surprise missions: target zones (never forbidden ones), time to get there, random missions (how often,
  from / until), whether the keyholder may send missions, declines per day, and the consequences *arrived in time* / *too late*.
- 🎮 **Toys** – toy control via XToys: on / off and an optional emergency-stop punishment. Toy actions are 🎮
  consequences in every rule; a *play* action can keep running until the situation ends (e.g. until the wearer leaves
  the zone). See [Toys](./toys).
- 📡 **Tracking** – **How is the location collected?** *Manual check-ins only*, *manual check-ins + background tracking*
  (default with tracking; both count) or *background tracking only* (no check-in button). With [background tracking](./background-tracking): missing-signal time and consequences, optional
  **quiet hours** (no missing-signal penalties at night) and a **warning** before the penalty, **OwnTracks mode** (*Auto* /
  *Move* / *Significant*).
- 🔔 **Notifications** – which events the keyholder gets as push notifications (see [Notifications](./notifications)).

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

## Settings file 💾

In the tab **💾 Import / Export**: **Export** downloads all settings as `lockation-config.json` – e.g. to reuse a setup for another lock or as a backup.
**Import** loads such a file into the page (it is validated; older files are converted). Nothing is saved until you save; the
disclaimer acceptance of the current lock is kept.

## Disclaimer ✅

The **Zones** tab first shows the disclaimer: tick **"I have read the disclaimer and use Lockation at my own risk"** to start.
Until then no zones or checkpoints can be added and saving fails; after accepting, the notice disappears. The confirmation is stored with the lock's configuration; if the [disclaimer](./disclaimer) changes
materially, you are asked again.

## Example setups

**"Stay home tonight"** – Zone *Home* (150 m, required). With background tracking: *must stay inside* 22:00–06:00, outside
during the window: add 2 h (cooldown 1 h). Without tracking: required check-in in *Home* every 2 h, grace 10 min, quiet hours
00:00–07:00; missed: add 2 h + freeze, success: unfreeze.

**"Gym motivation"** – Zone *Gym*. Reward zone, max 1 per day: remove 3 h.

**"Stay away from the bar"** – Background tracking + forbidden zone *Bar* (strict) only 20:00–02:00: warning after 2 min,
add 1 h after 10 min and every 5 min, extra punishment pillory 30 min *every 3rd time*.

**"Always tracked"** – Background tracking with *Live tracking only*, missing signal after 2 h: add 2 h + freeze.
Required zone *Home* every 6 h (missed: add 1 h + freeze, success: unfreeze). Forbidden zone *Bar*.

**"City hunt"** – 5 checkpoints with hints, *any order*, reveal *pin all*, block unlocking until completed, each checkpoint
removes 30 min, time limit 6 h (timeout: add 1 day).
