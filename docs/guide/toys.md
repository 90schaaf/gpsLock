# Toys (XToys) – test page

::: tip Status
Toy actions as consequences – one-off or kept running until the situation ends – work in locks.
:::

Lockation controls toys through [XToys](https://xtoys.app) and its **private webhook**. XToys talks to the toys
(Bluetooth, device apps); Lockation only tells XToys what to do. Open the **[toy test page](/app/toys.html)** – also
linked from the 🎮 Toys card on the main page and from the 🎮 Toys tab (also in the demo).

## Before you start

Read the safety notes on the page and accept them – in short: toys can start at any time while connected (also in
public or in a car), never use them while driving, e-stim never across the chest or heart, choose your limits carefully.

## Set up

1. **Your toys** – add each toy with its type and body part:

   | Type | Channels |
   |---|---|
   | Vibrator (1 motor) | main |
   | Vibrator (2 motors) | A, B |
   | E-stim (2 channels) | A, B |
   | Vibrator + rotator | vibration, rotation |
   | Rotator | main |

   Set the **maximum intensity** (per channel) and the **maximum duration** of one action. These limits are applied by
   Lockation **and** built into the XToys script.
2. **XToys script** – download it (it is made for exactly your toys; download it again after changes), import it in
   XToys, connect each real toy to its slot and start it. The script listens on your account's **Private Webhook**
   (cloud) – if XToys asks how to connect the webhook, choose the private one, **not the local webhook** (that one only
   works inside your own network), and allow *Script can send outbound messages*.
3. **Webhook ID** – XToys → your profile → *Private Webhook*. Enter it on the test page. It stays in your browser (only
   if you tick *Remember*) and is never sent to Lockation.

## Test

- **Test all toys** – a 2-second pulse on each toy, one after another.
- Per toy: pattern (*constant, pulse, wave, ramp*), intensity, duration, **set intensity / +10 % / −10 %** while
  something is running, ⚡ **shock** for e-stim, ■ stop.
- **Which toys does XToys see?** asks the script which real toys are connected to each slot.
- **■ STOP ALL TOYS** always works.

Every timed action is a pattern that ends by itself after its duration – a toy never keeps running because a `stop`
got lost.

**Export toy setup** saves your toys and limits as a file, so you can load them again later.

## In a lock

**Keyholder** – in the configuration, enable **🎮 Toys** and optionally set what the **emergency stop** costs (e.g.
+2 hours; leave it empty for none). Then add **🎮 Toy** consequences wherever you like (forbidden zones, missed check-ins, surprise zones,
missions, …):

- **Target**: a body part or all toys, optionally a toy type and a channel;
- **Action**: play a pattern (constant, pulse, wave, ramp) with intensity and duration – or [keep it running](#keep-running)
  until the situation ends –, **change the intensity** (to a value, or by e.g. +10 % – stronger at every penalty),
  ⚡ **shock** (e-stim) or **stop**.

**Wearer** – on the main page, card **🎮 Toys**: accept the safety notes, enter your Webhook ID and your toys (the
setup from the toy test page in the same browser is filled in), **Connect toys**. Then **▶ Test pulse** and **✓ My
toys reacted**. Toy actions are sent even before you confirm.

- Your **limits** are fixed while connected. To change them you have to disconnect – which is an emergency stop.
- **🛑 Emergency stop** – always possible: stops all toys, forgets your Webhook ID and applies the keyholder's
  punishment. You can connect again afterwards.
- No toys connected → toy actions are skipped and logged.
- Every toy action appears in the lock's history with full details – and a cheeky comment.
- The keyholder is notified when you connect, confirm or use the emergency stop – not for every single toy action.
- Your Webhook ID is stored on the Lockation server only while connected and is never shown to anyone (not even the
  keyholder). It is deleted on disconnect and when the lock ends; the toys get a final stop.

**Demo** – the demo has toy control enabled (the casino pulses your toys). Toy actions are only shown in the log, unless
you tick *really send the demo rules' toy actions to my toys* on the 🎮 Toys card.

## Keep running

A **▶ Play** action can, instead of a number of seconds, **keep running until the situation ends**. The editor offers
the endings that fit the trigger:

| Duration | Offered for | Ends |
|---|---|---|
| for … seconds | everywhere | after the seconds (at most the toy's limit) – a one-off action |
| until the wearer leaves the zone | anything triggered by *entering*: zone actions on enter, forbidden-zone penalties, rewards, surprise outcomes | on leaving |
| until the wearer is back in the zone | anything triggered by *leaving*: zone actions on leave, a surprise zone left too early, required zones (checking in outside, outside during a stay window) | on returning |
| until released | surprise outcomes with a hold | when the hold ends |
| for … minutes | everywhere (missed check-in, failed mission, …) | after the minutes |

- For the zone endings you can set **at the latest after … minutes** – otherwise it runs until the wearer leaves /
  comes back (or uses the emergency stop). The zone endings need **background tracking**.
- **Not stacked:** while it runs, the same action is not started again – e.g. a forbidden zone that punishes every
  5 minutes starts the wave once.
- **Stronger over time:** a *change the intensity* action (e.g. +10 % at every penalty) changes what keeps running, and
  the change sticks until it ends. A *stop* action ends it.
- Each start is a pattern that **ends by itself** after the toy's maximum duration; Lockation renews it about a minute
  before. If Lockation, the network or tracking fails, the toy stops on its own. Tip: a maximum duration of at least
  2 minutes per action keeps it running without gaps.
- A **one-off action** (e.g. the punishment pulse at the casino) takes the toy over for its duration; what keeps running
  resumes afterwards. Two on the same toy: the higher intensity wins.
- No toys connected yet → it waits and starts as soon as the wearer connects (while the situation lasts).
- Starts, intensity changes and stops appear in the lock history; renewals do not. The 🎮 Toys card shows what is running.
- The emergency stop, disconnecting and the end of the lock stop everything.

In the demo, the casino plays a wave that keeps running until you leave – 10 % stronger at every second penalty – on top
of the punishment pulse.
