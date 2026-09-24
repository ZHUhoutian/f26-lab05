# reservation-service: Smells and One Fix

Fill in each section. One section per milestone. Keep it short and specific. Point at files
and methods, not adjectives.

---

## Milestone 1: Three smells

Three smells, each in a different part of the module. For each one, fill in all five parts.

### Smell 1

**The smell.** Duplication over reuse: the pricing rule is implemented twice.
`ReportGenerator.priceOf` re-derives a booking's price with its own copies of the five
constants (`PREMIUM_RATE_MULTIPLIER`, `LONG_BOOKING_CUTOFF`, ...), when
`ReservationManager.calculatePrice` / `applyDiscounts` already compute it and every stored
`Booking` already carries the result in `priceCents`.

**Classic or agent-specific.** Agent-specific. The cause is missing context: the report code
was written without the pricing code in view, so the agent rebuilt the rule instead of
reusing it. The constants being renamed (`LONG_BOOKING_MINUTES` vs `LONG_BOOKING_CUTOFF`,
`EVENING_START_MINUTE` vs `EVENING_CUTOFF`) is the tell that this was a rewrite, not a copy.

**Where in the code.**
- `src/reportGenerator.ts`, lines 4-8 (duplicated constants), `ReportGenerator.priceOf`
  lines 104-117, called from `revenue` at line 77.
- Duplicates `src/reservationManager.ts`, lines 11-15 (original constants),
  `ReservationManager.calculatePrice` lines 140-147 and `applyDiscounts` lines 149-158.

**The principle it violates.** Information Expert (behavior near data). How a booking is
priced should have one expert, and the booking already holds the answer in `priceCents`.
Instead, `ReportGenerator` pulls the room's rate and the booking's times and does the
pricing work itself, away from the rule's owner. The result is two experts for one rule.

**What it makes expensive.** Any pricing change, e.g. "evening discount now starts at 18:00"
or "premium surcharge goes to 20%". Someone who edits `ReservationManager` gets a green
suite while the revenue report silently disagrees with what customers were charged. The
suite would not catch it: the only revenue test uses the standard room with no bookings of
three hours or more, so the premium and long-booking branches of `priceOf` are never
compared against the real price. It is also already wrong in one case: re-registering a
room with a new `hourlyRateCents` changes past revenue, because the report reprices history
instead of reading `priceCents`.

### Smell 2

**The smell.** Phantom complexity: a query cache that never caches anything.
`ReservationManager` builds a `QueryCache` and `listBookingsForRoom` checks it, but nothing
anywhere calls `cache.set`, so `get` always returns `undefined` and the method always falls
through to storage. `cacheConfig.ts` adds a TTL, a max-entries eviction policy, and
`withTtl` / `disabled` helpers that no code calls.

**Classic or agent-specific.** Agent-specific, from free volume (a cache layer cost the agent
nothing to write) and an underspecified request (nobody asked for caching or said reads were
slow, so the agent guessed). Classic name: speculative generality plus dead code.

**Where in the code.**
- `src/cache/queryCache.ts`, the whole file (lines 1-57): `get` lines 19-32, `set` lines
  35-46 (never called).
- `src/cache/cacheConfig.ts`, the whole file (lines 1-22): `withTtl` lines 15-17 and
  `disabled` lines 20-22 (never called).
- The only caller: `src/reservationManager.ts`, constructor line 41 (hard-wires
  `new QueryCache(DEFAULT_CACHE_CONFIG)`) and `listBookingsForRoom` lines 117-124 (the
  always-missing lookup at lines 118-122).

**The principle it violates.** Hidden coupling / controllability. The constructor always
builds the cache itself from a module-level default (`new QueryCache(DEFAULT_CACHE_CONFIG)`,
line 41), so a caller or test can't swap it out or disable it. The cache also reads the
system clock (`Date.now()` in `get`/`set`), which nothing outside can control. So every read
through `listBookingsForRoom` depends on state and time that aren't in any signature.

**What it makes expensive.** Reading and trusting the code: every reader has to trace the
cache to find out it does nothing. The bigger cost is the first person who "finishes" it by
adding `cache.set` in `listBookingsForRoom`. There is no invalidation in `createBooking` or
`cancelBooking`, so `formatDailySummary` would show a cancelled booking as confirmed for
up to 30 seconds. That bug is time-dependent, so the current suite would likely not see it.

### Smell 3

**The smell.** Speculative over-abstraction with a hidden dependency: a pluggable
notification registry (`ChannelBuilder` map, `registerChannel`, `registeredChannels`,
`NotifierConfig`, a one-member `ChannelName` union) that has exactly one plugin, `email`.
`ReservationManager` does not take a channel. Its constructor calls
`createNotificationChannel(DEFAULT_NOTIFIER_CONFIG)`, which reads a module-level mutable
`Map`.

**Classic or agent-specific.** Agent-specific: speculative over-abstraction, from an
underspecified request (we never said how many channels there would be, so the agent built
for N). Classic name: speculative generality. The global registry is a classic hidden
dependency.

**Where in the code.**
- `src/notifications/notifierFactory.ts`, the whole file (lines 1-42): one-member
  `ChannelName` at line 4, the global `builders` map at line 19, `registerChannel` /
  `registeredChannels` lines 22-29, `createNotificationChannel` lines 32-40, and the single
  registration at line 42.
- `src/reservationManager.ts`, constructor lines 38-42 (the hard-wired call at line 40), used
  by `dispatchNotification` lines 215-218.

**The principle it violates.** Low coupling (talk through interfaces). A
`NotificationChannel` interface already exists, but `ReservationManager` doesn't take one
through it. It reaches into `notifierFactory`'s global `builders` map and its
`DEFAULT_NOTIFIER_CONFIG` to get one. The manager is therefore coupled to the factory
module, its mutable global registry, and its config shape, instead of just to the
interface it actually calls (`send`). A side effect is poor controllability, because the
channel can't be swapped from outside.

**What it makes expensive.** Testing notifications, and adding a second channel. A test can't
hand the manager a fake channel. The only ways in are `registerChannel('email', ...)`, which
mutates global state shared by every other test in the process, or reading
`recentNotifications()`, which no test does today. So notification behavior is untested.
Adding SMS means widening `ChannelName`, registering a builder, *and* still editing the
`ReservationManager` constructor to pick it, so the registry doesn't save the edit it was
built to save.

---

## Milestone 2: One small fix

One fix, behavior preserved, suite green, zero test edits.

**Which smell you attacked.** And why that one.

**What changed.** Files and methods you touched, and what the code does differently now.

**What you deliberately did not touch.** Name the scope line you drew and why you drew it
there. "I ran out of time" is not a scope line.

**How you know behavior is preserved.** Point at the suite, say what it actually covers, and
say what it would not catch.

---

## Milestone 3: Two proposals and one false positive

One proposal for each milestone 1 smell you did not fix.

### Proposal A (not coded)

**The problem.** Name it.

**The decomposition.** What are the pieces, what does each own, and where do the rules live?

**One cost.** Something this actually costs. "No real downside" is not a cost.

### Proposal B (not coded)

**The problem.**

**The decomposition.**

**One cost.**

### The thing that looks smelly but is fine

**What it is.** File and method.

**Why it is fine.** Defend it with properties of the code, not with its line count.

**What would flip your verdict.** Name the change that would turn this into a real problem.
