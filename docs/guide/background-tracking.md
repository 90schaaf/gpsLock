# Background tracking

Normally Lockation only knows where you are when you tap **Check in**. If your keyholder enables
**background tracking**, your phone reports its location automatically with the free app
**OwnTracks**. The lock then reacts on its own, for example the moment you enter a forbidden
zone or leave home during a "must stay inside" window.

::: info Why a separate app?
Browsers (Safari, Chrome) don't let web pages use the location in the background. OwnTracks is
a well-known open-source app built exactly for this. It only sends your location to Lockation, and it
uses the phone's battery-friendly location services.
:::

## Setting it up (wearer)

1. Install OwnTracks: [iPhone (App Store)](https://apps.apple.com/app/owntracks/id692424691) ·
   [Android (Google Play)](https://play.google.com/store/apps/details?id=org.owntracks.android).
2. Open your lock in Chaster → *Lockation* → **📡 Set up background tracking**.
3. Tap **Open in OwnTracks**. OwnTracks imports the connection settings. Confirm the import if it asks.
   Opening the page on a computer? Scan the QR code with your phone's camera instead.
4. Give OwnTracks location access:
   - **iPhone:** Settings → OwnTracks → Location → **Always**, *Precise Location* on, and *Background App Refresh* on.
   - **Android:** App info → OwnTracks → Permissions → Location → **Allow all the time**; Battery → **Unrestricted**.
5. Back in Lockation the card shows the real connection state:
   - **not set up** – no phone connected;
   - **waiting for first location** – set up, but nothing has arrived from your phone yet (open OwnTracks once, check "Always");
   - **connected** – a location arrived within the missing-signal time;
   - **no signal** – the last location is older than that.

   It turns **connected** only after the first location arrives. OwnTracks also receives
   your lock's zones (and the hunt checkpoints you can see), so it can report entering and leaving them precisely.
6. Keep the OwnTracks **mode** the card tells you (*Move* or *Significant*). Lockation sets it when you connect and
   changes it remotely if the keyholder changes the setting.

The credentials are shown only once. If you lose them or change phones, tap **Set up again**. This creates new
credentials, and the old phone stops working.

If the link doesn't open, use *Manual setup*: in OwnTracks set the connection mode to **HTTP** and enter the URL,
username and password shown.

## What happens with background updates

| Rule | Behaviour with tracking |
|------|-------------------------|
| Required check-in | A background location inside a required zone counts as a check-in (if the keyholder allowed it). |
| Forbidden zones | A timeline: warning after 2 min, first penalty after 10 min, then every 5 min while you stay (adjustable) – see [Rules explained](./rules#forbidden-zones). |
| Reward zones | Can require a **minimum stay**, e.g. 45 minutes at the gym. |
| "Must stay inside" windows | Between e.g. 22:00 and 06:00 you must stay inside one of the required zones with an active window. |
| Travel goals | Counts your real route, not only the straight line between check-ins. |
| Scavenger hunt | Walking into a checkpoint completes it automatically; visible checkpoints are reported by OwnTracks the moment you arrive. Background updates are never wrong guesses. |

**Missing signal:** if Lockation receives no location for the configured time (phone off, app stopped,
permission removed, tracking never set up), the *missing signal* consequences apply – just like a missed check-in.
The default is **20 minutes** (minimum 15). That only works if the phone reports often: a phone lying still – especially an
iPhone in OwnTracks' battery-saving *Significant* mode – may stay silent for much longer. Keyholders should test it with the
wearer's phone and raise the value (e.g. 3–6 h), use **Move** mode, or set **quiet hours** if penalties appear while the
phone is simply not moving.

- **Quiet hours** (optional, e.g. 23:00–07:00): no missing-signal penalties or warnings at night. After the quiet hours the
  phone gets one full period to report.
- **Warning** (optional): N minutes before a missing-signal penalty you get a [notification](./notifications).

GPS edge cases: Lockation only treats you as having left a zone once you are clearly outside (accuracy taken into account),
so a jumpy GPS at the edge of a zone doesn't trigger anything.

## Live tracking only

The keyholder can make live tracking **mandatory**: manual check-ins are then switched off and the check-in button disappears.
Everything is decided by the locations OwnTracks sends:

- Being in a required zone (as reported in the background) counts as the check-in. After a missed deadline, the first location
  back inside the zone also applies the *successful check-in* consequences once (e.g. unfreeze).
- Scavenger hunt checkpoints are found by walking into them – there are no guesses.
- Without a connected phone the lock page shows **Set up live tracking!** and every missing signal is penalised.
  So connect OwnTracks right after the lock starts.

## Stopping

Tap **Stop background tracking** at any time. Your phone is disconnected immediately. You can also uninstall
OwnTracks. If the lock requires tracking, the missing-signal rule may then apply.

## Battery

| Mode | Reports | Battery |
|---|---|---|
| **Significant** | on major location changes and zone entries/exits | very low |
| **Move** | every few minutes / ~100 m while moving | higher |

The keyholder chooses the mode (*Tracking → OwnTracks mode*). *Auto* (default) uses **Move** when the missing-signal time is
under 60 minutes or forbidden zones are used – their minute-by-minute timeline needs frequent reports – otherwise **Significant**.
