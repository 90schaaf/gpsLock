# Toys (XToys) – test page

::: tip Status
Toy actions as consequences and effects *while* you are inside a zone work in locks.
:::

Lockation controls toys through [XToys](https://xtoys.app) and its **private webhook**. XToys talks to the toys
(Bluetooth, device apps); Lockation only tells XToys what to do. Open the **[toy test page](/app/toys.html)** – also
linked from the demo (🎮 Toy test).

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

**Keyholder** – in the configuration, enable **🎮 Toys** and set what the **emergency stop** costs (required, e.g.
+2 hours). Then add **🎮 Toy** consequences wherever you like (forbidden zones, missed check-ins, surprise zones,
missions, …):

- **Target**: a body part or all toys, optionally a toy type and a channel;
- **Action**: play a pattern (constant, pulse, wave, ramp) with intensity and duration, **change the intensity** (to a
  value, or by e.g. +10 % – stronger at every penalty), ⚡ **shock** (e-stim) or **stop**.

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

## Effects while inside

Besides one-off actions, the keyholder can let a toy **run as long as a condition holds**:

- **🎮 Toy effect while inside** – per zone (🗺 Zones tab): starts when the wearer enters, stops when they leave;
- **Effect while outside the required zones** – 🎮 Toys tab: runs until the wearer is back in a required zone.

Each effect has a target (body part, optionally toy type and channel), a pattern and an intensity. Both need
**background tracking** (otherwise Lockation would not notice that the wearer left).

- Each start is a pattern that **ends by itself** after the toy's maximum duration; Lockation renews it about a minute
  before. If Lockation, the network or tracking fails, the toy stops on its own. Tip: a maximum duration of at least
  2 minutes per action keeps effects running without gaps.
- A **one-off action** (e.g. the punishment pulse at the casino) takes the toy over for its duration; the effect resumes
  afterwards. Two effects on the same toy: the higher intensity wins.
- Starts and stops appear in the lock history; renewals do not. The 🎮 Toys card shows what is running.
- The emergency stop, disconnecting and the end of the lock stop everything.

In the demo, the casino plays a wave while you are inside (on top of the punishment pulse when you enter).
