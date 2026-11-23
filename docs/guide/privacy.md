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
- **Who can see the map and positions:** only the **wearer** and the **keyholder** of the lock. Anyone else who opens
  Lockation gets "not allowed" – no zones, positions or history. The keyholder sees the wearer's last reported position on the
  map **only with exact sharing**; in *zones only* mode just the names of the zones the wearer is currently in.
  The wearer's live position on the own map is computed in the wearer's browser and is not sent to the server by itself.
- Address search in the configuration page uses OpenStreetMap Nominatim; map tiles come from OpenStreetMap (OpenStreetMap
  sees which map area is loaded, not your GPS position).

## Fair play

Browser GPS can be faked by determined users (developer tools, mock-location apps). Lockation makes
this harder – accuracy and age checks, speed plausibility, optional verification pictures – but it
is a **trust-assisted game**, not proof. Keyholders: use verification pictures if you need more certainty.

## Safety

Never configure rules that pressure someone to go to unsafe places or to travel when it is not safe.
Chaster's emergency unlock is unaffected by Lockation.

## Contact & data requests

Lockation is a community project. For questions, bug reports and data requests use the issue tracker:
[github.com/90schaaf/lockation/issues](https://github.com/90schaaf/lockation/issues).

- Stored data (check-in history, phone pairing) is **deleted automatically when the lock ends**.
- To have data deleted earlier, open an issue **without posting personal data** (no usernames, locations or lock IDs) –
  a maintainer will reply and arrange the details privately.
