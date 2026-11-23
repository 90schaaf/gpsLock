# Privacy & fairness

## What is stored

| Data | Zones only (default) | Exact |
|------|----------------------|-------|
| Which zones you were in, accuracy, result, consequences | ✅ | ✅ |
| Coordinates of each check-in (visible to keyholder) | ❌ | ✅ |
| Last accepted position (needed for speed and travel checks; never shown) | rounded to ~110 m | exact |
| Background tracking: every location update | evaluated, then discarded – only zone changes and consequences are kept | as left, plus coordinates of recorded events |

- The wearer can switch from *exact* to *zones only* at any time on the check-in page. Existing
  coordinates are removed from the history immediately. This cannot be reversed while the lock runs.
- A keyholder cannot enable exact sharing while the lock is running.
- When the lock ends, all Lockation history is deleted.
- Without [background tracking](./background-tracking) Lockation never sees your position unless you tap *Check in*.
- With background tracking, OwnTracks sends your location to the Lockation server only. Only the wearer can connect a phone, and the wearer can disconnect it at any time. The keyholder sees zone entries and exits, not a live map (unless exact sharing is enabled, then the coordinates of those events). The phone credentials are stored only as a hash and are deleted when the lock ends.
- Address search in the configuration page uses OpenStreetMap Nominatim; map tiles come from OpenStreetMap.

## Fair play

Browser GPS can be faked by determined users (developer tools, mock-location apps). Lockation makes
this harder – accuracy and age checks, speed plausibility, optional verification pictures – but it
is a **trust-assisted game**, not proof. Keyholders: use verification pictures if you need more certainty.

## Safety

Never configure rules that pressure someone to go to unsafe places or to travel when it is not safe.
Chaster's emergency unlock is unaffected by Lockation.
