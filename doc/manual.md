# The Epistrophy manual

Epistrophy has no dependency and no build or installation step. The `lib`
directory contains all the files needed. The `Fiber` and `Scheduler` objects
are exported by `lib/unrated.js`, but it is simpler to import `run` from
`lib/shell.js` instead.

## The Epistrophy model

Epistrophy is a concurrency model implemented as a small DSL (domain-specific
language) in vanilla JS. It introduces a cooperative threading model in which
sequences of _instructions_ are executed on _fibers_ which can run concurrently
with the help of a _scheduler_. The model also introduces an abstract _logical
time_ to make the runtime behaviour of a program more deterministic and
predictable than using raw asynchronous primitves and APIs like Promises,
`async/await` or `fetch`: synchronous operations have no duration and all
happen within the same instant; only delays and asynchronous function calls
move time forward.

As a DSL, Epistrophy can be thought of like any other programming language: a
program (as represented by fibers and their instructions) is first created,
then executed by the scheduler (by scheduling fibers to run at a certain time).
Here is a tiny Epistrophy program:

```js
import { Fiber, Scheduler } from "./lib/unrated.js";
const fiber = new Fiber().
    ramp(1000).
    sync(() => { console.log("Hello, world!"); });
const scheduler = new Scheduler();
scheduler.scheduleFiber(fiber, 0);
scheduler.clock.start();
```

The first threee lines after the `import` create a new fiber and add
instructions to it (a one-second delay, followed by a call to `console.log()`).
This is the program that will run. To run it, we need to create a Scheduler,
then schedule the fiber we created to run as soon as the scheduler starts
running. The scheduler is driven by a clock and updates the state of the fibers
that it manages at regular intervals, running every fiber that is scheduled
within that interval (the clock is using `requestAnimationFrame()` internally,
making Epistrophy suitable for visual-driven applications like graphical user
interfaces, games, or multimedia presentations). The final line starts the
clock so that the program actually begins.

Epistrophy is built around a minimal core of six instructions:

* _sync_ executes a synchronous function;
* _ramp_ waits until some amount of time (given in milliseconds) has elapsed;
* _event_ waits until a DOM event is received;
* _async_ starts an asynchronous function calls and waits until a value or an
error is returned;
* _spawn_ schedules a new child fiber (with its own sequence of instructions)
to begin in the same instant;
* _join_ waits until all spawned children have ended;

When a fiber is running, it keeps executing instructions one after the other
until it reaches the end of the sequence (which ends the fiber), or an
instruction that needs to wait (_ramp_, if the duration is greater than zero;
_event_, _async_, and _join_, if child fibers have been spawned). In that case,
the scheduler reschedules the fiber at a definite time (in the case of a ramp),
or sets up the necessary mechanism (such as an event listener for an event) to
schedule the fiber again when the condition that it is waiting on is fulfilled.

## Creating and scheduling fibers

A fiber object is created with `new Fiber()`, which returns a fiber with an
empty list of instructions. Instructions can then be added with the following
methods. The runtime behaviour of these instructions is detailed below.

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
instance and scheduler) that returns a string, and `delegate` an optional
object with methods for customizing event handling.

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

`Fiber.ever(f)` creates a subsequence within the sequence of instructions of
the fiber during which instructions get executed even when the fiber has an
error (allowing error handling and recovery), returning the fiber. `f` should
be a function of one argument that gets called immediately with the fiber.

A fiber needs instructions to run, but also needs to be scheduled. A new
scheduler is created with `new Scheduler()`, which returns a scheduler object
with a stopped clock and an empty schedule.

`Scheduler.scheduleFiber(fiber, t)` schedules a new runtime instance of the
fiber to run at time t (in milliseconds). The original fiber is returned.

`Scheduler.clock` returns the scheduler’s clock; the main methods of the clock
are: `Clock.start()` to start the clock, `Clock.stop()` to stop the clock, and
`Clock.now` to access the current clock time (total running time in
milliseconds since the clock started).

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
* `ramp(dur, f)` begins the ramp and yields for `dur` milliseconds (unless
`dur` is zero; `f` still gets called with _p_ = 0 and 1 synchronously before
execution resumes). If `dur` is a function, it first gets called with the fiber
instance and scheduler as arguments to get the duration for this specific ramp.
If `f` is provided, it gets called with a progress value _p_ (the ratio of
elapsed time to the duration of the ramp), the fiber instance, and the
scheduler:
    * once when the ramp begins, with _p_ = 0;
    * once when the ramp ends, with _p_ = 1, unless the duration is infinite
    (because the ramp never ends);
    * zero or more times on every scheduler update, with 0 < _p_ < 1 (if the
    duration is finite) or _p_ = 0 (if the duration is infinite).
* `event(target, type, delegate)` sets up an event listener for events of
`type` on `target` and yields until an event is received. If either is a
function, that function gets called with the fiber instance and scheduler as
arguments to provide the current target and/or type for this specific event
listener. The following delegate methods, if provided, are called:
    * `eventShouldBeIgnored(event, fiber, scheduler)`: when the event occurs,
    this gets called with the event, fiber instance, and scheduler (and the
    delegate object itself as `this`). If this method returns `true`, then that
    specific event is ignored and the fiber keeps yielding until another event
    is received.
    * `eventWasHandled(event, fiber, scheduler)`: if the event was not ignored,
    this gets called with the event, fiber instance, and scheduler (and the
    delegate object itself as `this`), allowing custom handling of the event,
    such as calling `preventDefault` or accessing properties of the event
    before the fiber resumes.
* `async(f, delegate)` calls the function `f` with the current fiber instance
and scheduler as arguments, and yields until the returned Promise or thenable
gets resolved or rejected. The following delegate methods, if present, are
called:
    * `asyncWillEndWithValue(value, fiber, scheduler)`: when the promise is
    resolved, this gets called with the eventual value, fiber instance, and
    scheduler (and the delegate object itself as `this`).
    * `asyncWillEndWithError(error, fiber, scheduler)`: when the promise is
    rejected, this gets called with the eventual error, fiber instance, and
    scheduler (and the delegate object itself as `this`). The fiber `error`
    property is also set.
    * `asyncWasCancelled(fiber, scheduler)`: if the parent fiber gets
    cancelled, this gets called with the fiber instance and scheduler (and the
    delegate object as `this`). Note that the promise may still get resolved or
    rejected _after_ the fiber was cancelled, but this will not affect the
    fiber.
* `spawn` schedules a child fiber to begin in the same instant, that is as soon
as this fiber yields. The child instance is added to the `children` property of
the parent fiber, while the `parent` property of the child instance is set to
this fiber instance. Note that `spawn` itself does _not_ yield so execution
continues before the child fiber actually begins; this allows for more than one
fiber to be spawned in the same instant (the children then begin in the same
instant, but in the order in which they were spawned).
* `join(delegate)` does yield until all fibers in the `children` array have
ended, after having cleared the `children` property. The following delegate
methods, if present, are called:
    * `fiberWillJoin(fiber, scheduler)`: when the join begins, before yielding,
    this gets called with the fiber instance and scheduler as arguments (and
    the delegate object itself as `this`).
    * `childFiberDidJoin(child, scheduler)`: when a child fiber ends, this gets
    called with the child fiber instance and scheduler as arguments (and the
    delegate object itself as `this`). Recall that the fiber instance itself is
    the parent of the child fiber.

At runtime, fiber instances are not `Fiber` objects but rather `ScheduledFiber`
objects, and have the following additional properties and methods:

* `ScheduledFiber.now` is the local time of the fiber, _i.e._, the number of
milliseconds elapsed since the fiber first started running.
* `ScheduledFiber.parent` is the parent fiber, if the fiber was spawned from a
fiber, and not directly created and scheduled.
* `ScheduledFiber.scope` is an object that can hold any data that the fiber
needs during its execution; if the fiber has a parent, its scope is created
from the parent’s scope, otherwise it is initialized as an empty object.

When running, the scheduler provides the following properties that fibers can
make use of to affect the runtime of the program:

* `Scheduler.now` is the local time of the scheduler, _i.e._, the number of
milliseconds elapsed since the scheduler started running. This is the global
instant in which fibers are running. It is only defined during an update
interval.
* `Scheduler.attachFiber(fiber, child)` creates and schedule an instance of the
`child` fiber and adds it as a child of `fiber`. This is the runtime version of
`Fiber.spawn`.
* `Scheduler.cancelFiber(fiber)` cancels `fiber` by setting its error to a
special Cancel error and scheduling the fiber to resume in the current instant
(unless the current instruction of the fiber is inside an `ever` block, in
which case the fiber continues running normally). If the fiber is joining,
child fibers are cancelled as well.
* `Scheduler.setRampDurationForFiber(fiber, dur)` updates the duration of the
current ramp of `fiber` to the new duration `dur` (a number of milliseconds).
This has no effect if there is no ongoing fiber. If the new duration is shorter
than the elapsed time of the ramp, it ends immediately.

The scheduler also sends events (using the DOM `CustomEvent` API) during
execution, which can be listened to with `Scheduler.addEventListener` (as
`Scheduler` is a DOM `EventTarget`). All events have a `detail` property
with specific information about the event:

* `error` is sent when an error occur during execution (such as an exception
being thrown, or a Promise being rejected). Details of the event are `fiber`
(the fiber instance that is being executed), and `error` (the error value
itself).
* `update` is sent after the scheduler has run all fibers in the interval
between the last and current clock tick. Details of the event are `begin` and
`end` (the time interval during which fibers did run), and `idle` (true when
the clock is idle, meaning that no further update is currently planned).

## Shell

The core of Epistrophy is kept deliberately small in order to manage
complexity. However, to make it more user-friendly, a _shell_ adds additional
convenience for useful patterns built on top of the core library.

* `run()` creates a scheduler and a top-level fiber, starts the clock, and
returns the fiber. Error messages from the scheduler are also logged to the
console. With this function, the “Hello, world!” program shown above becomes:

```js
import { run } from "./lib/shell.js";
run().ramp(1000).sync(() => { console.log("Hello, world!"); });
```

* `PreventDefault` is a delegate object that calls `preventDefault()` on an
event that was just handled. For example, to wait for any key to be pressed
without any other side effect (like scrolling the window if an arrow key is
pressed):

```js
fiber.event(window, "keydown", PreventDefault);
```

* `First` is a delegate object that can be used as a parameter for `Fiber.join`
which cancels all sibling fibers as soon as the child fiber joins. This is a
common pattern to handle one of several possible outcomes. For example, waiting
for a button to be clicked while setting a timeout for 3 seconds:

```js
fiber.
    spawn(fiber => fiber.event(button, "click")).
    spawn(fiber => fiber.ramp(3000)).
    join(First);
```

If the button is clicked before the ramp ends, then the ramp is cancelled; if
the button is not clicked by the time the click end, then the event listener
on the button is removed. If no delegate was specified, the behaviour here
would be to wait _at least_ 3 seconds before continuing, even if the button was
clicked earlier.

* `cancelSiblings(child, scheduler)` is used by the `First` delegate to cancel
the sibling fibers of the `child` fiber (in the context of `scheduler`). This
can be used for a join delegate that needs to do more than just cancel these
fibers. In the example below, two fibers are spawned for buttons that can
increment or decrement a counter; the join delegate calls `cancelSiblings` to
cancel the fiber with the button that was not clicked, but also updates the
counter value carried by the parent fiber, based on which button was clicked:

```js
fiber.
    sync(fiber => { fiber.scope.count = 0; }).
    repeat(fiber => fiber.
        spawn(fiber => fiber.
            event(PlusButton, "click").
            sync(fiber => { fiber.scope.increment = 1; })
        ).
        spawn(fiber => fiber.
            event(MinusButton, "click").
            sync(fiber => { fiber.scope.increment = -1; })
        ).
        join({
            childFiberDidJoin(child, scheduler) {
                if (!child.error) {
                    cancelSiblings(child, scheduler);
                    child.setOriginalValue(
                        "count",
                        child.scope.count + child.scope.increment
                    );
                }
            }
        })
    );
```

See the defition of `Fiber.repeat()` and `ScheduledFiber.setOriginalValue()`
below.

### Fiber utilities

The shell adds convenience methods to fibers:

* `Fiber.macro(f)` calls the function `f` with the fiber as its argument and
returns the fiber. This allows setting up more complex chains of operations
in the same manner as adding a single instruction. For example, given a
`loadImage` function that creates a Promise of a DOM Image for a given URL,
any number of images can be loaded concurrently from a list of URLs by spawning
a new fiber for each URL, then joining to wait for all images to be loaded:

```js
fiber.macro(fiber => {
    for (const src of ImageURLs) {
        fiber.spawn(fiber.async(loadImage(src)));
    }
}).join();
```

* `Fiber.repeat(f, delegate)` spawns a new child fiber and immediately joins;
when the child fiber ends, it is immediately spawned again, repeating forever.
If no argument is provided, then the child fiber is returned. If present, `f`
should be a function of one argument that gets called immediately with the
newly created child fiber, while the parent fiber gets returned. The optional
delegate object is similar to the join delegate object, and may also have the
following method:
    * `repeatShouldEnd(i, fiber, scheduler)`: before spawning a new instance of
    the child fiber, this gets called with the current number of iterations
    (starting at 0 before the first iteration begins), the fiber instance, and
    the scheduler (with the delegate itself as `this`). If this method returns
    true, then no new instance is spawned and the repeat immediately ends.

The following example will output “Tick...” to the console every second for
three seconds:

```js
fiber.repeat(fiber => fiber.
    ramp(1000).
    sync(() => { console.log("Tick..."); }), {
    repeatShouldEnd: i => i === 3
});
```

These additional methods are available at runtime:

* `ScheduledFiber.setOriginalValue(name, value)`: sets the value of a property
named `name` to `value` _in its original scope_, that is, the scope of the
fiber in which this property was originally defined (see example usage above).
If this property was not previously defined, then it is set on the fiber’s own
scope.
