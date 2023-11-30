Epistrophy is a virtual machine (VM) for [synchronous
programming](https://en.wikipedia.org/wiki/Synchronous_programming_language)
on the Web. It introduces low-level primitives such as synchronous computations
and effects (that execute instantly), asynchronous computations, delays,
events, and logical threads for concurrent execution. Although the VM aims to be
useful on its own, it is really designed to implement a [higher-level timing and
synchronization model for Web
applications](https://github.com/stcucufa/frownland).

⚠️ This is a work in progress and some features discussed below are in various
stages and design and implementation. ⚠️

Here is an example of using Epistrophy:

```js
import { VM } from "./lib/vm.js";
import { Thread } from "./lib/thread.js";

const button = document.querySelector("button");
const span = document.querySelector("span");

VM().start().spawn().
    instant(() => 0).
    label("loop").
    set(span, "textContent").
    spawn(Thread().event(button, "click")).
    join(false).
    instant(x => x + 1).
    jump("loop");
```

A new virtual machine is created with `VM()`. The VM has a _clock_ and a
_scheduler_. The scheduler manages _threads_, which are lists of instructions
that the VM executes in sequence. Synchronous instructions take no time to
execute, so the machine continues running until it encounters an asynchronous
instruction. The current thread is then _suspended_ and scheduled to resume
execution at a later time. When the clock is running, periodic updates are
generated, and the VM executes all threads that are scheduled at times falling
in the interval between the last and the current update time.
`VM().start().spawn()` creates a VM, starts its clock immediately, and spawns a
top-level thread to which instructions can be added.

This main thread starts by instantly producing a value with `instant(() => 0)`.
It then sets up a label which will be the target of a jump later. `set(span,
"textContent")` sets the text content of the span element to the current thread
value, which is 0. Then a new thread (created with `Thread()`) is spawned. This
child thread has only one instruction: waiting for a single click event from
the button element. The two threads run concurrently, so while the child thread
waits for an event, the parent thread continues running and reaches the
`join(false)` instruction. This pauses the thread until the thread that it
spawned ends; the `false` flag means that the value that that thread ends with
will be discarded. At this point, both threads are suspended and execution
stops, even though the clock is still running.

When the user clicks on the button, the child thread can continue executing,
and reaches the end of its list of instruction; it therefore ends with the
event object as its value. The parent thread itself can then resume execution,
and produces a new value instantly by applying the function `x => x + 1` to its
current value (0), producing the new thread value of 1. Executing the next
instruction jumps to the previously set label (named `loop`) and continues from
that point, so the text content of the span is updated to the current value of
the thread (_i.e._, it goes from 0 to 1), and a new child thread is spawned to
listen to another button click.

The effect of this program is to increment a counter every time a button is
pressed. While it may seem convoluted, it is intended as introducing the main
features of Epistrophy. In this case, spawning a child thread to listen to
button clicks is not strictly necessary, but a benefit of this approach is that
the main thread value is simply an ever-increasing counter and no extra storage
is needed. Larger applications can benefit from these synchronization mechanisms
to leave a lot of state management to the VM and the scheduler and focus on the
data that actually matters. This will be explored further with a much higher
level declarative timing and synchronization model.

The major benefit of the synchronous approach is to bring structure to
the current state of interactive programming on the Web. Dealing with callbacks,
event handlers, promises, async/await, CSS animations and transitions, and media
elements means that the state of an application is scattered all over its code
and must be tracked through ad hoc mechanisms that require a lot of careful
bookkeeping. This is complex, error-prone, and therefore the source of many
small glitches or serious bugs. Introducing threads provides a consistent way of
sequencing and repeting computations, whether they are synchronous or
asynchronous, while spawning and joining brings structure to concurrency by
adding an explicit hierarchy of tasks running in parallel.

This approach benefits both developers and end users. Time can be freely
manipulated through the VM clock, so that a program can be paused, run slower,
faster, or even backward. This is achieved by having the scheduler keep track
not only of the times at which a thread resumes, but also of keeping track of
when a thread _was_ previously resumed; and by providing primitives for pure,
instantaneous computations (that have no side effect and can thus safely be
executed again and again), and for managing effects (by implementing some undo
and redo behaviour). Knowing the semantics and timing of these primitives also
allows to visualize the execution of an Epistrophy program through a timeline of
events past, present and future. Time manipulation and visualization are
powerful tools for debugging and testing, allowing developers to author complex
behaviours with more ease and confidence, and can help accessibility by giving
more control to users.

While the clock can be manipulated programmatically, Epistrophy also provides
a ready to use transport bar widget that can be simply added to a page, letting
the user or developer in control of the flow of time. A timeline visualizer is
also provided, to be added to a page as well during development. The screenshot
below shows both of these elements displayed alongside the code of a running
program.

![Screenshot of Epistrophy with the transport bar and
timeline](doc/screenshot.png)

Epistrophy has no dependencies and requires no build step. It can be used as is
by importing objects from its `lib` directory. An automated test suite and
examples can be found in the `tests` and `examples` directory. A local Web
server may be required in order to import files however, depending on browser
settings.
