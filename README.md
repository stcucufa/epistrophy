Epistrophy is an experimental concurrent runtime for [synchronous
programming](https://en.wikipedia.org/wiki/Synchronous_programming_language)
on the Web. It introduces low-level primitives such as synchronous computations
and effects (that execute instantly), asynchronous computations, delays,
events, and logical threads (_fibers_) for concurrent execution.

⚠️ This is a work in progress and some features discussed below are in various
stages of design and implementation. ⚠️

The major benefit of the synchronous approach is to bring structure to
the current state of interactive programming on the Web. Dealing with callbacks,
event handlers, promises, async/await, CSS animations and transitions, and media
elements means that the state of an application is scattered all over its code
and must be tracked through _ad hoc_ mechanisms that require a lot of careful
bookkeeping. This is complex, error-prone, and therefore the source of many
small glitches or serious bugs. Introducing fibers provides a consistent way of
sequencing and repeating computations, whether they are synchronous or
asynchronous, while spawning and joining brings structure to concurrency by
adding an explicit hierarchy of tasks running concurrently.

This approach benefits both developers and end users. Time can be freely
manipulated through the runtime clock, so that a program can be paused, run
slower, faster, or even backward. This is achieved by having a scheduler keep
track not only of the times at which a fiber resumes execution, but also
keeping track of when a fiber _was_ previously resumed; and by providing
primitives for pure, instantaneous computations (that have no side effect and
can thus safely be executed again and again), and for managing effects (by
implementing some undo and redo behaviour). Knowing the semantics and timing of
these primitives also allows to visualize the execution of an Epistrophy
program through a timeline of events past, present and future. Time
manipulation and visualization are powerful tools for debugging and testing,
allowing developers to author complex behaviours with more ease and confidence,
and can help accessibility by giving more control to users.

## See Epistrophy in action

Clone this repository, then start a web server from the root of the repo
(_e.g._ by running `python -m http.server 7890`) and visit
[the examples directory](http://localhost:7890/examples/).

## An introduction to Epistrophy

This is a complete Epistrophy program that implements the [classic example from
the programming language Esterel](https://en.wikipedia.org/wiki/Esterel#Example_(ABRO)):
O turns on when both A and B buttons have been pressed, in any order; the R
button resets the system.

```js
const [A, B, R] = document.querySelectorAll("button");
const O = document.querySelector("span.O");

run().repeat(fiber => fiber.
    spawn(fiber => fiber.
        spawn(fiber => fiber.event(A, "click").sync(() => { A.disabled = true; })).
        spawn(fiber => fiber.event(B, "click").sync(() => { B.disabled = true; })).
        join().
        sync(() => { O.classList.add("on"); }).
        ramp(Infinity).
        ever(fiber => fiber.
            sync(() => {
                A.disabled = false;
                B.disabled = false;
                O.classList.remove("on");
            })
        )
    ).
    spawn(fiber => fiber.event(R, "click")).
    join(First)
);
```

In Epistrophy, all computations are organized in fibers that are run by a
scheduler. The `run()` function creates both a scheduler and a fiber that can
act as the main fiber, and returns that fiber. Instructions such as `repeat`,
`spawn`, `event`, `sync`, `join` or `ramp` are added in sequence to the fibers
to define their runtime behaviour. `run()` also starts the scheduler’s clock
and schedules the main fiber to begin immediately.

Here the main fiber has a single `repeat` instruction, which creates a fiber,
runs it to completion, then begins the same fiber again immediately. That
repeated fiber itself spawns two child fibers: the first handles the A and B
button, while the second simply waits for a click event from the R button. The
`join` instruction then makes the fiber yield while it waits for these two
child fibers to end (we will come back to the `First` parameter below). The
first child fiber itself spawns two new fibers, one that listens to click
events from the A button, and one that listens to click events from the B
button, before waiting for them for end as well.

When this program starts running, all these fibers are spawned and start
running immediately in depth-first order; then they all yield, waiting for
either an event to occur or their child fibers to end. The `event` instruction
waits for an event from a target, and ends when that event occurs. So if the
user presses the A button, the corresponding event instruction will end and the
scheduler will resume the execution of its fiber. The next instruction is
`sync`, which executes a function synchronously. In this case, since A was
pressed, it becomes disabled. A sync instruction ends immediately so the fiber
keeps executing, but now it reaches its end as there are no more instructions
to execute. Its parent fiber is notified, but because it has another child that
has not ended yet, nothing more happens.

If the user then presses the B button, the second event instruction ends and
the B button gets disabled as well. The fiber ends and notifies its parent.
Now that both of its children have ended, the parent’s `join` instruction ends
as well, and execution of the fiber resumes: the O light gets turned on
synchronously, then the `ramp` instruction begins. A ramp is a delay of a given
duration that can also execute a callback function at regular intervals; here,
it does nothing and has an inifinite duration, so that fiber is suspended
indefinitely.

If the user then presses the R button, the second fiber in the repeat body ends
and notifies its parent. This time the `join` instruction as an extra parameter
(`First`), which is a _join delegate_. Delegates have methods that get called
when a join begins or when a child fiber ends; in this case, `First` has a
method that gets called when the first child ends and then _cancels_ all the
other siblings. In this case, this means that the sibling fiber that was
suspended indefinitely gets cancelled.

Cancellation is a kind of error. Since fibers can run arbitrary computations,
errors may occur. When an error occurs, the fiber is in an error state and
resumes execution, but instructions are skipped if the fiber is in error, which
results in fibers ending immediately on error. However, it is possible to
ensure that an instruction (or a sequence of instructions) runs even when the
fiber has an error by wrapping it in `ever`, which is a mechanism for error
recovery (sort of similar to a `finally` block after a try).

When the suspended fiber gets cancelled, this means that its error is set to a
Cancel error, so execution resumes, effectively ending the infinite ramp. The
next instruction is indeed wrapped in `ever` so it does run normally; its
effect is to restore the the initial state of the A, B and O elements. Then the
fiber ends and the parent is notified; the `join(First)` instruction ends as
well, and that fiber ends. Because it is wrapped in a `repeat` instruction,
it immediately begins again, setting up event listeners for A, B, and R and
waiting for clicks on this buttons to resume execution.
