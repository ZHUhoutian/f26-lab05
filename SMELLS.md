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

**Where in the code.** (Line numbers are for the starter code, commit `3ad9375`, before the
Milestone 2 fix removed this duplicate.)
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
- The only caller: `src/reservationManager.ts`, constructor line 36 (hard-wires
  `new QueryCache(DEFAULT_CACHE_CONFIG)`) and `listBookingsForRoom` lines 112-119 (the
  always-missing lookup at lines 113-117).

**The principle it violates.** Hidden coupling / controllability. The constructor always
builds the cache itself from a module-level default (`new QueryCache(DEFAULT_CACHE_CONFIG)`,
line 36), so a caller or test can't swap it out or disable it. The cache also reads the
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
`Map`. `DEFAULT_NOTIFIER_CONFIG` looks like a setting, but the constructor has no parameter
for it. The only way to change the channel is to change global state that every manager
shares: either change the exported default object's fields, or overwrite the registry
entry.

**Classic or agent-specific.** Agent-specific: speculative over-abstraction, from an
underspecified request (we never said how many channels there would be, so the agent built
for N). Classic name: speculative generality. The global registry is a classic hidden
dependency.

**Where in the code.**
- `src/notifications/notifierFactory.ts`, the whole file (lines 1-42): one-member
  `ChannelName` at line 4, the global `builders` map at line 19, `registerChannel` /
  `registeredChannels` lines 22-29, `createNotificationChannel` lines 32-40, and the single
  registration at line 42.
- `src/reservationManager.ts`, constructor lines 33-37 (the hard-wired call at line 35), used
  by `dispatchNotification` lines 194-197.

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

**Which smell you attacked.** Smell 1, the pricing rule implemented twice. It is the only one
of the three where two copies can already disagree, and the suite can't catch it. It is
also the one with a small, pure fix: the two copies compute the same thing in the same
rounding order (base, premium, long, evening), so merging them changes no output.

**What changed.**
- New `src/pricing.ts`: `priceFor(room, start, end)` plus a private `applyDiscounts`, and the
  five constants, now defined once. The code is moved from `ReservationManager`
  unchanged.
- `src/reservationManager.ts`: removed the five constants and the private `applyDiscounts`.
  `calculatePrice` is now a one-line delegate to `priceFor`.
- `src/reportGenerator.ts`: removed the five duplicated constants and the private `priceOf`
  and `durationOf` (`durationOf` had no other caller). `revenue` now calls
  `priceFor(room, booking.start, booking.end)`.

Callers see no difference. The rule now lives in one place, so a pricing change is one edit.

**What you deliberately did not touch.** The scope line: *remove the second copy of the rule,
and change no observable behavior.*
- I did not switch `revenue` to sum `booking.priceCents`. That is the more
  Information-Expert fix, but it changes output when a room is re-registered with a new
  rate: reports would show what was charged instead of the current rate. That is a
  behavior change, so it is a decision for whoever owns reports, not a refactor.
- I kept `ReservationManager.calculatePrice` as a public delegate instead of deleting it.
  It is public API, and removing it would break callers for no gain in this fix.
- I did not touch the other overlap duplicates (`hasConflict`, `isSlotFree`,
  `overlapsWindow`, `freeMinutes` vs `occupancy`). They are the same kind of smell, but a
  different rule. Folding them in would turn one small diff into a sweep.

**How you know behavior is preserved.** `npm test` passes 39/39 and `npm run typecheck` is
clean, with no test edited. The `pricing` tests in `tests/booking.test.ts` pin every branch
of `priceFor` through `createBooking`: plain (12000), long (16200), premium (18400), and
evening (11400). The `reports` tests in `tests/reporting.test.ts` check that revenue equals
the sum of `priceCents`, for standard-room bookings only. What the suite would **not**
catch: a premium or three-hour-plus booking priced differently in reports than at booking
time. That gap is why the duplicate was dangerous. After this change it can't happen,
because both paths call the same function.

---

## Milestone 3: Two proposals and one false positive

One proposal for each milestone 1 smell you did not fix.

### Proposal A (not coded)

For smell 2, the query cache that never caches.

**The problem.** Phantom complexity plus hidden coupling. `ReservationManager` builds a
`QueryCache` it never fills. The cache reads a global default config and the system clock,
and it has no invalidation for when bookings are written.

**The decomposition.** Two steps. Only the first is proposed now.
1. **Delete it.** Remove `src/cache/`, the `cache` field and its construction in the
   `ReservationManager` constructor, and the dead lookup in `listBookingsForRoom`, which then
   just returns `storage.findByRoom(roomId)`. This is behavior-preserving today, because
   every lookup misses.
2. **Only if a measured need appears** (e.g. storage becomes a slow database), put caching
   *behind* the storage boundary instead of inside the manager: a
   `CachingStorageProvider implements StorageProvider` that wraps another provider and
   takes a clock as a constructor argument.
   - The wrapper owns the cache and its invalidation.
   - Invalidation lives in the wrapper's `save` and `update`, because every write goes
     through them. That is exactly where the current design has nothing.
   - `ReservationManager` keeps depending only on `StorageProvider` and never learns that
     caching exists.

**One cost.** `QueryCache`, `withTtl`, `disabled` and `DEFAULT_CACHE_CONFIG` are exported, and
we can't see callers outside this repo. Deleting them is a breaking change for anyone who
imports them. And if caching is ever really needed, someone has to write the wrapper from
scratch instead of starting from existing code.

### Proposal B (not coded)

For smell 3, the notification registry.

**The problem.** Speculative over-abstraction and coupling that skips the interface. A plugin
registry with one plugin, and a `ReservationManager` that gets its channel from the
factory's global map and default config instead of depending only on
`NotificationChannel`.

**The decomposition.** Inject the channel through the constructor, the same way `storage`
already is:
`constructor(storage: StorageProvider = new InMemoryStorageProvider(), notifier: NotificationChannel = new EmailChannel())`.
Then delete `src/notifications/notifierFactory.ts`. Each piece owns one decision:
- **`ReservationManager`** decides *when* to notify (on confirm and cancel) and *what* to
  say (the receipt from `formatReceipt`).
- **A `NotificationChannel` implementation** (`EmailChannel`, later maybe `SmsChannel`)
  decides *how* a message is delivered.
- **Whoever constructs the manager** (application setup, or a test) decides *which* channel
  is used. A test can now pass in a fake channel and check exactly what was sent, without
  touching global state.

**One cost.** The manager still has to import the concrete `EmailChannel` for its default
argument, so it isn't fully decoupled from one implementation. Removing that default to get
full decoupling would force every caller to build and pass a channel, including every
existing test through `newService()` in `tests/fixtures.ts`.

### The thing that looks smelly but is fine

**What it is.** `src/validation.ts`, `validateReservationRequest` (lines 14-63). It is about
50 lines and eleven `if` checks, split up by section comments (`// Times.`, `// Capacity.`,
...). It looks like Long method, and the comments look like Comments as deodorant.

**Why it is fine.**
- **It does one job.** Lecture's Long method was one method doing six jobs: validation,
  availability, pricing, persistence, notification and logging. This one only validates.
  It never touches storage, pricing, notifications or the clock.
- **It is a pure function.** Given `(request, room)`, it returns a `ValidationResult`. There
  are no side effects and no hidden dependencies, so every rule can be tested directly;
  `tests/validation.test.ts` tests it without building a `ReservationManager`.
- **The order of the checks is part of its contract.** It returns on the first problem "so
  the caller can report one clear reason" (lines 10-13). The order decides which reason the
  caller sees, e.g. a malformed time is reported before a capacity problem. Splitting the
  checks into separate functions would still need a caller that runs them in this exact
  order, so it would add indirection without removing any logic.
- **The comments group the checks.** They don't restate what each line does.

**What would flip your verdict.**
- A rule that needs outside state, e.g. "no overlap with existing bookings" (needs storage)
  or "book at least 24 hours ahead" (needs the clock). It would stop being pure, gain a
  hidden dependency, and start mixing jobs.
- More branching on room kind, e.g. `if (room.premium) ... else if (room.kind === 'lab')
  ...`. That turns it into Type checks instead of polymorphism. The premium rule at lines
  58-60 is the first branch of that kind, so this is the change to watch for.
