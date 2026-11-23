# What is GPS Lock?

GPS Lock is an extension for [Chaster](https://chaster.app) that connects your lock to
**where you are**. A keyholder (or you, on a self-lock) draws zones on a map and decides
what happens when you are – or are not – in those zones.

::: warning Beta
GPS Lock is in beta. Expect rough edges and please report problems to the extension author.
:::

## How it works in one minute

1. **The keyholder configures** zones and rules when creating the lock (see [Configuring a lock](./configuration)).
2. **You check in** by opening the lock in Chaster → *GPS Lock* → **Check in now**. Your phone
   sends one GPS position. See [Checking in](./checking-in).
3. **GPS Lock evaluates the rules** and applies the consequences right away – for example
   adding time, freezing the lock, or assigning a task. Everything shows up in the lock history.
4. **Deadlines are enforced even if you never open the page.** A missed required check-in is
   penalised automatically by the server.

::: tip GPS Lock does not track you
A web page cannot follow you in the background. GPS Lock only sees your position at the moment
**you** tap *Check in*, unless your keyholder enables optional [background tracking](./background-tracking) with the OwnTracks app.
:::

## The rules at a glance

| Rule | What it means for the wearer |
|------|------------------------------|
| [Required check-in](./rules#required-check-in) | Check in every *N* hours, at a specific place or anywhere. |
| [Forbidden zones](./rules#forbidden-zones) | Checking in inside such a zone is penalised. |
| [Reward zones](./rules#reward-zones) | Checking in there gives a reward (limited per day). |
| [Travel goals](./rules#travel-goals) | Every *X* km between check-ins counts. |
| [Scavenger hunt](./rules#scavenger-hunt) | Find checkpoints in order using hints. |
| [Curfew](./rules#curfew) | Stay inside a zone during set hours (needs background tracking). |

Every rule can trigger **consequences**: add/remove time, freeze/unfreeze, pillory, task,
verification picture, a log entry, or a command of another extension.

## Try it without Chaster

The [demo](/app/?demo) runs entirely in your browser. You can tap the map to pretend to be
somewhere and see exactly what would happen.
