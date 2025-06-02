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

## See Epistrophy in action

Clone this repository, then start a web server from the root of the repo
(_e.g._ by running `python -m http.server 7890`) and visit
[the examples directory](http://localhost:7890/examples/). If you are curious,
you can also [run the test suite](http://localhost:7890/test/).

## An introduction to Epistrophy

This project is an effort to build a synchronous programming environment in a
bottom up manner, starting from basic primitives and building layers of
powerful and expressive abstractions on top. Here is a short example of using
these low-level primitives to implement a counter, given two HTML elements: a
`span` that displays the counter value, and a `button` that can be clicked to
increment it. The complete example is:

```js
Scheduler.run().
    exec(() => 0).
    repeat(fiber => fiber.
        effect(({ value: count }) => { span.textContent = count.toString(); }).
        event(button, "click").
        exec(({ value: count }) => count + 1)
    );
```

Let’s go through it line by line to explain how it works.

```js
Scheduler.run().
```

initializes the runtime by creating a `Scheduler` object that starts running
immediately, and an initial `Fiber` object. These are the two most important
objects of Epistrophy: fibers carry values and computations, and the scheduler
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

creates an infinite loop (there are ways to break out of a loop based on
duration, number of iterations, or some condition being met, but here the
program will run until the page is closed). The body of the loop is described by
a function of the fiber that adds more instructions.

```js
        effect(({ value: count }) => { span.textContent = count.toString(); }).
```

is the first instruction in the loop. It is almost identical to `exec`, with the
difference that it does not affect the value of the fiber; as its name implies,
it is only used for the effect(s) of the wrapped function. That function gets
called with two arguments: the fiber object itself, and the scheduler that is
running it. Here only the `value` property of the fiber is of interest; as it
is the value of the counter we give it a more specific name. The effect is to
set the text content of the `span` element to display the current count on the
page.

```js
        event(button, "click").
```

is next, and suspends execution until a specific event is received. Here, the
intent is to wait for a `click` event from `button`. Once this event happens,
execution resumes with the next instruction,

```js
        exec(({ value: count }) => count + 1)
```

another instance of `exec`, which increments the fiber’s value, _i.e._ the
count, by one.

Since the scheduler is running, it will start executing the fiber right away,
starting from the first instruction. Executing the function wrapped by `exec`,
the fiber value is set to 0. Then we enter the loop and run the `effect`
instruction, which sets the content of the `span` to the value of the fiber,
which is now `0`: this initializes the display of the counter to its initial
value. Then we wait for a click event from the button.

Waiting means that the scheduler suspends the execution of the fiber, and only
resumes it once the event happens. Other fibers can get their turn executing
once a fiber is suspended, but here there is no other fiber so nothing happens
until the user clicks the button.

Then execution resumes with the next instruction, which sets the value of the
fiber to its current value plus one; after the first click, the value of the
fiber changes from 0 to 1. Because the end of the loop is reached, execution
jumps back to the beginning of the loop and executes the effect, updating the
display of the counter to 1, and waiting for a new click event from the button.
This goes on indefinitely, increasing the counter by one on each button click.

This example may seem convoluted, but it introduces some of the main concepts
of the runtime, like mixing synchronous computations and asynchronous events
seamlessly, and avoid introducing unnecessary state variables (for instance to
keep track of the counter value). Let’s make this example more interesting by
adding a second button to decrement the counter; instead of having a single
`button` element, we now have an array of two buttons. The first one will
decrement the value of the counter by one, and the second one will increment
it by one.

```js
Scheduler.run().
    exec(() => 0).
    repeat(fiber => fiber.
        effect(({ value: count }) => span.textContent = count.toString()).
        spawn(fiber => fiber.
            event(buttons[0], "click").
            exec(({ value: count }) => count -= 1)
        ).
        spawn(fiber => fiber.
            event(buttons[1], "click").
            exec(({ value: count }) => count += 1)
        ).
        join(First())
    );
```

The first few lines are identical but then we reach:

```js
        spawn(fiber => fiber.
```

which creates a new child fiber from the main fiber. The instructions that this
fiber runs are:

```js
            event(buttons[0], "click").
            exec(({ value: count }) => count -= 1)
```

which we now understand as waiting for a click from the first button, then
decrementing the value of the fiber. Unlike the main fiber, which started with
no value and was explicitly initialized to zero, this fiber starts with its
parent value, that is the current value of the counter. This is followed by
spawning a second child fiber that increments the value when the second button
is clicked.

These two `spawn`s are followed by:

```js
        join(First())
```

which waits until the child fibers end. In its simplest form, `join()` waits for
all of its children to end before resuming execution. But here this would mean
that if the user clicked on the “increment” button, they would also have to
click on the “decrement” button before execution of the main fiber would resume.
In general, we also want to be able to do something with the values of the child
fibers, so `join()` accepts a delegate object as its parameter, with a
`childFiberDidEnd()` method that gets called when a child fiber ends. We see
a first abstraction built on top of the primitives of the runtime here with the
call to `First()`, which provides a delegate for `join()` that allows the fiber
to resume as soon as the first of its child fiber ends execution, and cancels
all the other siblings, and setting the value of the fiber to the end value of
its child.

When this example runs, the main fiber gets an initial value of 0 as in the
first example, then spawns two child fibers. These two fibers do not begin
their execution until the parent yields, which it does when calling `join()`
(it is thus possible for the parent to *not* call `join()` and keep running,
letting its children run independently when they get the chance).

Now that the parent fiber is suspended, the scheduler starts executing the
child fibers in turn. The first one begins with its parent value of 0, and
immediately yields, waiting for a click event from the first button. The
scheduler now starts executing the second fiber, which also begins with a value
of 0, and also yields immediately. All three fibers are now suspended until
one of the buttons is clicked.

Let’s say that the user eventually clicks on the first button. This causes the
first child fiber to resume execution, decrementing its value by one, and then
ending with a value of -1 as it runs out of instructions. Because the fiber has
a parent that is joining, the scheduler handles the ending of the fiber by
keeping track of how many children are still running, and calling the relevant
delegate method. As described above, the `First` delegate handles the first
fiber ending by cancelling all other fibers, effectively meaning that the
second child fiber, currently suspended, will not resume. The delegate method
also sets the parent fiber value to that of the child that just ended, so the
parent fiber value is now -1. Execution of the parent resumes with this new
value, and since `join()` was the last instruction in the loop, the loop
continues from the start, updating the display of the counter value to -1, and
spawning again two new fibers waiting for button events to increment or
decrement that new value.
