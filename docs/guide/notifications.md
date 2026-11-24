# Notifications

Lockation can send push notifications to your phone with the free **ntfy** app
([iPhone](https://apps.apple.com/app/ntfy/id1625396347) · [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
Both the wearer and the keyholder can set them up – each gets their own private channel.

## Setting up

1. Install **ntfy**.
2. Open Lockation on the lock and tap **🔔 Set up notifications**.
3. Tap **Open in ntfy** (or scan the QR code) – ntfy subscribes to your private channel. A **"✅ Lockation test notification"**
   is sent right away; **Send test notification** sends another one at any time to check that everything works.

**Stop notifications** removes the channel at any time. It is also removed automatically when the lock ends.

## What you get

**Wearer – warnings** (so you can react before a penalty):

| Warning | When |
|---|---|
| Forbidden zone | after the first warning time inside (default 2 min), and 1 min after each penalty |
| No location from your phone | N minutes before a missing-signal penalty (if the keyholder enabled it; never during quiet hours) |
| Check-in due soon | N minutes before a required deadline (if enabled) |
| Rules changed | when the keyholder changes the rules during the lock |

A warning is never sent together with or after the penalty it warns about. Every warning is also written to the lock history.

**Keyholder – events** (each can be switched on/off in the configuration, *Notifications*):

| Event | Default |
|---|---|
| Penalty applied (any rule) | on |
| Forbidden zone entered (at the first warning, before the first penalty) | on |
| Missing signal, tracking set up / connected / stopped | on |
| Required check-in missed | on |
| Required check-in done | off |
| Hunt checkpoint found / completed / failed | on |
| Reward earned | off |
| Verification picture requested | on |

At most one notification per event type and zone every 5 minutes; several events at once arrive as one message.
On self-locks only the wearer notifications exist.

## Privacy

Notification texts contain zone names and consequences ("You are in the forbidden zone *Bar* – leave within 8 min or: add 1h"),
**never coordinates** – not even with exact sharing. Hidden hunt checkpoints are never named for the wearer.
ntfy.sh transports the messages encrypted (TLS) but can read their text; the channel name is a long random secret.
Server operators can use their own ntfy server instead (see the technical setup).
