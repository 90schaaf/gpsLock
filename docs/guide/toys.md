# Toys (XToys) – test page

::: warning Preview
Toy control during a lock is **not available yet** (it is being built – see the roadmap). The toy test page already
works: set up your toys and try them with the Lockation XToys script.
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
   XToys, connect the **webhook block** to your **private webhook** (enable *Script can send outbound messages*) and
   connect each real toy to its slot. Start the script.
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
