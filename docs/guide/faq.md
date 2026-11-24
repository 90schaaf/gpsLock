# FAQ & troubleshooting

**The check-in button does nothing / permission denied.**
Allow location for your browser or the Chaster app (see [Checking in](./checking-in#allowing-location-access)) and reload. Inside Chaster, use **Open in new tab** if the prompt does not appear.

**My check-in was rejected because of accuracy.**
Go outside, wait 10–20 seconds, retry. Rejected check-ins have no consequences.

**I was at home but it said "Not inside a required zone".**
The zone may be too small for your GPS accuracy. Ask your keyholder to enlarge it (150 m+ works well indoors) or to use *lenient* matching.

**I missed a check-in because I was asleep.**
Ask your keyholder to configure *quiet hours*.

**Does Lockation drain my battery?**
No. It only uses GPS for a few seconds when you tap *Check in*.

**Can my keyholder see where I am right now?**
No. Only at your check-ins, and only the coordinates if *exact* sharing is enabled.

**A consequence shows "failed".**
The extension it needs is probably not enabled on the lock (e.g. Pillory, Tasks, Verification Picture). The other consequences were still applied.

**Can Lockation control Find the key / Jigsaw / Reward store / Typing lines?**
Not yet – Chaster does not offer commands for these extensions yet. Once it does, they appear in the configuration automatically.

## Background tracking stays at "waiting for first location"

The server hasn't received anything from your phone yet.

- **OwnTracks still on its factory settings?** Its status shows `mqtts://user@host:8883` (often with *kCFErrorDomainCFNetwork
  error 2*). The setup link wasn't imported. **iPhone:** in OwnTracks tap **ⓘ → Settings → Remote control → ⓘ** and turn on
  **"Allow external configuration"**, then tap **Set up again** in Lockation, open the new link and confirm **"Process
  Configuration"**. Or enter the values from **Manual setup** (Mode **HTTP**, URL, username, password).
- **Set up again after importing?** Every *Set up again* disables the previous login – import the newest link.
- **Nothing sent yet?** Tap **↑** (publish) in OwnTracks; in battery-saving mode it waits for a larger movement.
- **Permissions:** location **Always** (iPhone) / **Allow all the time** (Android), precise location on.
