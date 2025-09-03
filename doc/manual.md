# The Epistrophy manual

Epistrophy has no dependency and no build or installation step. The `lib`
directory contains all the files needed. The `Fiber` and `Scheduler` objects
are exported by `lib/unrated.js`, but it is simpler to import `run` from
`lib/shell.js` instead.

## Concepts

Epistrophy is a concurrency model implemented as a small DSL (domain-specific
language) in vanilla JS.

## Creating and scheduling fibers

A fiber object is created with `new Fiber()`, which returns a fiber with an
empty list of instructions. Instructions can then be added with the following
methods.

`Fiber.sync(f)` adds a `sync` instruction to the fiber and returns the fiber.
`f` should be a synchronous function of two parameters (a fiber instance and
scheduler) that gets called when the instruction is executed.

`Fiber.ramp(dur, f)` adds a `ramp` instruction to the fiber and returns the
fiber. `dur` should be a number greater than or equal to zero, or a function
of two arguments (a fiber instance and scheduler) that returns a number greater
than or equal to zero, specifying the duration of the ramp in milliseconds.
The optional parameter `f` should be a function of three arguments (a progress
value between 0 and 1, a fiber instance and scheduler) that gets called while
the ramp is progressing.

`Fiber.event(target, type, delegate)` adds an `event` instruction to the fiber
and returns the fiber. `target` should be an EventTarget object or a function
of two parameters (a fiber instance and scheduler) that returns an EventTarget
object, `type` should be a string or a function of two parameters (a fiber
isntance and scheduler) that returns a string, and `delegate` an optional
object with methods for customizing event handling (see below).

`Fiber.async(f, delegate)` adds an `async` instruction to the fiber and returns
the fiber. `f` should be an asynchronous function (or a function returning a
Promise or thenable object synchronously) of two parameters (a fiber instance
and scheduler), and `delegate` an optional object with methods for customizing
the promise being resolved, rejected, or the fiber being cancelled while the
promise is still pending.

`Fiber.spawn(f)` creates a new child fiber and adds a `spawn` instruction to
the parent fiber. If no argument is provided, then the child fiber is returned.
If present, `f` should be a function of one argument that gets called
immediately with the newly created child fiber, while the parent fiber gets
returned.

`Fiber.join(delegate)` adds a `join` instruction to the fiber and returns the
fiber. `delegate` is an optional object for customizing the beginning of the
join, and handling individual child fibers ending.

`Fiber.repeat(f)` creates a new child fiber and adds a `repeat` instruction to
the parent fiber. If no argument is provided, then the child fiber is returned.
If present, `f` should be a function of one argument that gets called
immediately with the newly created child fiber, while the parent fiber gets
returned.

`Fiber.ever(f)` creates a subsequence within the sequence of instructions of
the fiber during which instructions get executed even when the fiber has an
error (allowing error handling and recovery), returning the fiber. `f` should
be a function of one argument that gets called immediately with the fiber.

A fiber needs instructions to run, but also needs to be scheduled. A new
scheduler is created with `new Scheduler()`, which returns a scheduler object
with a default clock and an empty schedule.

`Scheduler.scheduleFiber(fiber, t)` schedules a new runtime instance of the
fiber to run at time t (in milliseconds). The original fiber is returned.

`Scheduler.clock` accesses the clock of the scheduler; the main methods of the
clock are: `Clock.start()` to start the clock, `Clock.stop()` to stop the clock,
and `Clock.now` to access the current clock time (total running time in
milliseconds since the clock started).

The typical setup for an Epistrophy program is thus:

```js
const scheduler = new Scheduler();
const fiber = scheduler.schedule(
    new Fiber().
        sync(...).
        ramp(...).
        spawn(...).
        ...,
    0
);
scheduler.clock.start();
```

## Runtime

Once the clock is running, it sends tick messages to the scheduler, which then
runs all fibers that have a scheduled begin time in the interval between the
previous and current update times. Once a fiber begins, its instructions are
executed one after the other until the end of the sequence or until an
instruction yields. The scheduler catches exceptions that may be thrown during
execution of an instruction and sets the `error` property of the fiber. Every
subsequent instruction is then skipped, unless wrapped inside an `ever` block.

* `sync(f)` calls the function `f` with the current fiber instance and
scheduler as arguments and resumes execution as soon as `f` returns.
* `ramp(dur, f)` begins the ramp and yields for `dur` milliseconds. If `dur`
is a function, it first gets called with the fiber instance and scheduler as
arguments to get the duration for this specific ramp. If `f` is provided, it
gets called with a progress value _p_, the fiber instance, and the scheduler
    * when the ramp begins, with _p_ = 0;
    * when the ramp ends, with _p_ = 1, unless the duration is infinite (since
    the ramp then never ends);
    * on every scheduler update with 0 < _p_ < 1 (if duration is finite) or
    _p_ = 0 (if the duration is infinite). The _p_ value indicates the
    ratio of elapsed time to the total duration of the fiber.
* `event(target, type, delegate)` sets up an event listener for events of
`type` on `target` and yields until the event is received. If either is a
function, that function gets called with the fiber instance and scheduler as
arguments to provide the current target and/or type for this specific event
listener. The following delegate methods, if provided, are called:
    * `eventShouldBeIgnored`: when the event occurs, this gets called with the
    event, fiber instance, and scheduler (and the delegate object itself as
    `this`). If this method returns `true`, then that specific event is ignored
    and the fiber keeps yielding until another event is received.
    * `eventWasHandled`: if the event was not ignored, this gets called with
    the event, fiber instance, and scheduler (and the delegate object itself
    as `this`), allowing custom handling of the event, such as calling
    `preventDefault` or accessing properties of the event before the fiber
    resumes.
* `async(f, delegate)` calls the function `f` with the current fiber instance
and scheduler as arguments, and yields until the returned Promise or thenable
gets resolved or rejected. The following delegate methods, if present, are
called:
    * `asyncWillEndWithValue`: when the promise is resolved, this gets called
    with the eventual value, fiber instance, and scheduler (and the delegate
    object itself as `this`).
    * `asyncWillEndWithError`: when the promise is rejected, this gets called
    with the eventual error, fiber instance, and scheduler (and the delegate
    object itself as `this`). The fiber `error` property is also set.
    * `asyncWasCancelled`: if the parent fiber gets cancelled, this gets
    called with the fiber instance and scheduler (and the delegate object
    as `this`). Note that the promise may still get resolved or rejected
    _after_ the fiber was cancelled, but this will not affect the fiber.
* `spawn` schedules a child fiber to begin as soon as this fiber yields. The
child instance is added to the `children` property of the parent fiber, while
the `parent` property of the child instance is set to this fiber instance.
Note that `spawn` itself does _not_ yield so execution continues before the
child fiber actually begins.
* `join(delegate)` does yield until all fibers in the `children` array have
ended, after having cleared the `children` property. The following delegate
methods, if present, are called:
    * `fiberWillJoin`: when the join begins, before yielding, this gets called
    with the fiber instance and scheduler as arguments (and the delegate object
    itself as `this`).
    * `childFiberDidJoin`: when a child fiber ends, this gets called with the
    child fiber instance and scheduler as arguments (and the delegate object
    itself as `this`). Recall that the fiber instance itself is the parent of
    the child fiber.
* `repeat(delegate)` behaves like a combination of spawn and join for a single
fiber, but a new instance of the child fiber is spawned immediately after the
previous instance ends. The same delegate methods as join are called, in
addition to:
    * `repeatShouldEnd`: before spawning a new instance of the child fiber,
    this gets called with the current number of iterations (starting at 0
    before the first iteration), the fiber instance, and the scheduler (with
    the delegate itself as `this`). If this method returns true, then no
    new instance is spawned and the repeat immediately ends.

At runtime, fiber instances have the following additional properties and
methods:

* `now` is the local time of the fiber, _i.e._, the number of milliseconds
elapsed since the fiber first started running.
* `parent` is the parent fiber, if the fiber was spawned from a fiber, and
not directly created and scheduled.
* `scope` is an object that can hold any data that the fiber needs during its
execution; if the fiber has a parent, its scope is created from the parent’s
scope, otherwise it is initialized as an empty object.

When running, the scheduler provides the following methods that fibers can
make use of to affect the runtime of the program:

* `Scheduler.attachFiber(fiber, child)` creates and schedule an instance of the
`child` fiber and adds it as a child of `fiber`. This is the runtime version of
`Fiber.spawn`.
* `Scheduler.cancelFiber(fiber)` cancels `fiber` by setting its error to a
special Cancel error.
* `Scheduler.setRampDurationForFiber(fiber, dur)` updates the duration of the
current ramp of `fiber` to the new duration `dur` (a number of milliseconds).
This has no effect if there is no ongoing fiber. If the new duration is shorter
than the elapsed time of the ramp, it ends immediately.

The scheduler also sends events (using the DOM `CustomEvent` API) during
execution, which can be listened to with `Scheduler.addEventListener` (as
`Scheduler` is a DOM `EventTarget`). All events have a `detail` property
with specific information for the event:

* `error` is sent when an error occur during execution (such as an exception
being thrown, or a Promise being rejected). Details of the event are `fiber`
(the fiber instance that is being executed), and `error` (the error object
itself).
* `update` is sent after the scheduler has run all fibers in the interval
between the last and current clock tick. Details of the event are `begin` and
`end` (the time interval during which fibers did run), and `idle` (true when
the clock is idle, meaning that no further is currently planned).

## Shell

The core of Epistrophy is kept deliberately small in order to manage
complexity. However, to make it more user-friendly, a _shell_ adds additional
convenience for useful patterns built on top of the core library.

* `run()` creates a scheduler and a top-level fiber, starts the clock, and
returns the fiber.
* `First` is a delegate object that can be used as a parameter for `Fiber.join`
which cancels all sibling fibers as soon as the fiber child fiber joins.
* `cancelSiblings(child, scheduler)` is used by the `First` delegate to cancel
the sibling fibers of the `child` fiber (in the context of `scheduler`). This
can be used for a join delegate that needs to do more than just cancel these
fibers.
