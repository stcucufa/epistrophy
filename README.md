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
slower, faster, or even backward. This is achieved by having the scheduler keep
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

This project is an effort to build a synchronous programming environment in a
bottom up manner, starting from basic primitives and building layers of
powerful and expressive abstractions on top. Here is a simple example of using
these low-level primitives to implement a counter given two HTML elements: a
`span` that displays the counter value, and a `button` that can be clicked to
increment it.

```js
Scheduler.run().
    exec(() => 0).
    repeat(fiber => fiber.
        effect(({ value }) => { span.textContent = value.toString(); }).
        event(button, "click").
        exec(({ value }) => value + 1)
    );
```

Let’s go through this example line by line to explain how this works.

```js
Scheduler.run().
```

initializes the runtime by creating a `Scheduler` object that starts running
immediately, and an initial `Fiber` object. These are the two most important
objects in Epistrophy: fibers carry values and computations, and the scheduler
schedules the execution of the fibers in time. `Scheduler.run` returns the fiber
that it created, and new instructions are added to that fiber.

```js
    exec(() => 0).
```

is an instruction that wraps a function and sets the value of the fiber to the
value returned by that function when it gets executed. Here, the intent is to
initialize the fiber with the value 0. Calling `exec()` adds an instruction to
the fiber but does not call the wrapped function; this will only happen when the
scheduler lets that fiber execute. The fiber itself is returned so that other
instructions can be added to it.

```js
    repeat(fiber => fiber.
```

creates an infinite loop (there are ways to break out of the loop based on
duration, number of iterations, or some condition being met, but here the
program will run until the page is closed). The body of the loop is described by
a function of the fiber that adds more instructions.

```js
        effect(({ value }) => { span.textContent = value.toString(); }).
```

is the first instruction in the loop. It is almost identical to `exec`, with the
difference that it does not affect the value of the fiber. As its name implies,
it is only used for the effects of the wrapped function. That function gets
called with two parameters: the fiber object itself, and the scheduler that is
running it. Here only the `value` property of the fiber is of interest; the
effect is to set the text content of the `span` element to that value,
displaying the value of the counter on the page.

```js
        event(button, "click").
```

is next, which suspends execution until a specific event is received. Here, the
intent is to wait for a `click` event from `button`. Once this event happens,
execution resumes with the next instruction,

```js
        exec(({ value }) => value + 1)
```

another instance of `exec`, which increments the fiber’s value by one.

Since the scheduler is running, it will start executing the fiber right away,
starting from the first instruction. Executing the function wrapped by `exec`,
the fiber value is set to 0. Then we enter the loop and run the `effect`
instruction, which sets the content of the `span` to the value of the fiber,
which is now `0`: this initializes the display of the counter to its initial
value. Then we wait for a click event from the button.

Waiting here means the scheduler suspends the execution of the fiber, and only
resumes it once the event happens. Other fibers can get their turn executing
once a fiber is suspended, but here there is no other fiber so nothing happens
until the user clicks the button.

Then execution resumes with the next instruction, which sets the value of the
fiber to its current value plus one; after the first click, the value of the
fiber changes from 0 to 1. Because the end of the loop is reached, execution
jumps back to the beginning of the loop and executes the effect, updating the
display of the counter to 1, and waiting for a new click event from the button.
This goes on indefinitely, increasing the counter by one on each button click.
