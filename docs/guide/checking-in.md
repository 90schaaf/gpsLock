# Checking in

## Open Lockation

In Chaster open your running lock. You will find **GPS check-in** in the lock's action list
(it shows the next deadline and a **!** badge when overdue), or open the extension from the
extensions section of the lock.

::: tip Live tracking only
If the keyholder enabled *live tracking only*, there is no check-in button – your location comes from OwnTracks.
See [Background tracking](./background-tracking#live-tracking-only).
:::

## The check-in page

- **Required check-in card** – countdown to the next deadline.
- **Scavenger hunt card** – progress, the current hint and, depending on settings, how far away you are.
- **Travel card** – kilometres until the next travel goal.
- **📍 Check in now** – sends your current position once.
- **🧭 Submit hunt guess here** – only during a hunt: says *"I think the checkpoint is here"*.
  A wrong guess may cost time. A normal check-in never counts as a wrong guess,
  but it still completes a checkpoint if you happen to be there.
- **Map** – all zones: green = required, red = forbidden, yellow = reward, purple dashed = next checkpoint (if revealed).
- **Rules of this lock** – a plain language summary of everything that can happen.
- **History** – your past check-ins and their consequences.

## Getting a good GPS position

- Go **outside** or stand near a window. Indoors, accuracy is often worse than 100 m.
- Wait a few seconds after unlocking the phone; the first position is often imprecise.
- If a check-in is **rejected for accuracy**, simply try again – a rejected check-in has no consequences.

## Allowing location access

The first time, your phone asks for permission. Choose **Allow** (or *Allow while using*).

**iPhone (Safari / Chaster app)**
Settings → Privacy & Security → Location Services → turn on → *Safari Websites* (or the Chaster app) → **While Using the App** and enable **Precise Location**.

**Android (Chrome / Chaster app)**
Settings → Location → turn on → App permissions → Chrome (or Chaster) → **Allow only while using the app**, enable **Use precise location**.

If the permission prompt never shows up inside Chaster, tap **Open in new tab** in the error box –
the check-in page then opens directly in your browser and works the same way.

## Why was my check-in rejected?

| Message | Meaning |
|---------|---------|
| *GPS accuracy too low* | Your position is less precise than the lock requires. Go outside and retry. |
| *The GPS position is outdated* | The phone returned a cached position. Retry. |
| *Too many check-ins* | Wait a minute between check-ins. |
| *Implausible movement* | You seem to have moved impossibly fast since the last check-in (GPS jump or spoofing). Depending on settings this is rejected, penalised, or a verification picture is requested. |
