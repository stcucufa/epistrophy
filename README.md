# Epistrophy

Epistrophy is an experimental concurrent runtime for [synchronous programming](https://en.wikipedia.org/wiki/Synchronous_programming_language) on the Web implemented as a vanilla JS library. It is built on an abstract timing and synchronisation model that defines low-level primitives such as synchronous computations, delays, events and asynchronous computations, and uses logical threads (_fibers_) for concurrent execution.

The major benefit of the synchronous approach is to bring structure to the current state of interactive programming on the Web. Dealing with callbacks, event handlers, promises, async/await, CSS animations and transitions, and media elements means that the state of an application is scattered all over its code and must be tracked through _ad hoc_ mechanisms that require a lot of careful bookkeeping. This is complex, error-prone, and therefore the source of many small glitches or serious bugs. Introducing fibers provides a consistent way of sequencing and repeating computations, whether they are synchronous or asynchronous, while spawning and joining fibers brings structure to concurrency by adding an explicit hierarchy of tasks running concurrently.

This approach benefits both developers and end users. Time can be freely manipulated through the runtime clock, so that a program can be paused, run slower, faster, or even backward. This is achieved by having a scheduler keep track not only of the times at which a fiber resumes execution, but also keeping track of when a fiber _was_ previously resumed; and by providing primitives for pure, instantaneous computations (that have no side effect and can thus safely be executed again and again), and for managing effects (by implementing some undo and redo behaviour). Knowing the semantics and timing of these primitives also allows to visualize the execution of an Epistrophy program through a timeline of events past, present and future. Time manipulation and visualization are powerful tools for debugging and testing, allowing developers to author complex behaviours with more ease and confidence, and can help accessibility by giving more control to users.

## See Epistrophy in action

Epistrophy has no dependency and requires no build step. To run locally, clone this repository, then start a web server from the root of the repo (_e.g._, by running `python -m http.server 7890`) and visit [the examples directory](http://localhost:7890/examples/). A [complete manual](doc/manual.md) is available in the `doc` directory.

## A first look at Epistrophy

This is a complete Epistrophy program that implements the [the programming language Esterel](https://en.wikipedia.org/wiki/Esterel): O turns on when both A and B buttons have been pressed, in any order; the R button resets the system.

```js
// Use the Epistrophy shell.
import { run, First } from "../lib/shell.js";

// Inputs and outputs.
const [A, B, R] = document.querySelectorAll("button");
const O = document.querySelector("span.O");

// This starts the scheduler with a main fiber.
run().

    // Add instructions to the fiber, starting with the outer loop.
    repeat(fiber => fiber.

        // Spawn the “AB” fiber: listen to events from buttons A
        // and B, then light up O. Reset all elements to their
        // initial state when the fiber ends.
        spawn(fiber => fiber.

            // Wait for A to be pressed and disable it.
            spawn(fiber => fiber.
                event(A, "click").
                call(() => { A.disabled = true; })
            ).

            // Wait for B to be pressed and disable it.
            spawn(fiber => fiber.
                event(B, "click").
                call(() => { B.disabled = true; })
            ).

            // Resume when both buttons have been pressed.
            join().

            // Light up O and wait indefinitely.
            call(() => { O.classList.add("on"); }).
            ramp(Infinity).

            // When the fiber is cancelled, reset all elements
            // their initial state.
            ever(fiber => fiber.
                call(() => {
                    A.disabled = false;
                    B.disabled = false;
                    O.classList.remove("on");
                })
            )
        ).

        // Spawn the “R” fiber: wait for button R to be pressed.
        spawn(fiber => fiber.event(R, "click")).

        // End as soon as the first fiber ends (which will be R)
        // and repeat immediately.
        join(First)
    );
```

The structure of the Epistrophy program is very similar to that of the Esterel program, but less succinct and more complex; more imperative. There are two reasons to that: first, it does more than Esterel, which only handles signals (the `call` instructions have no equivalent in the Esterel program); second, Epistrophy works at a much lower level than Esterel, so a construct like `[await A || await B]` requires spawning two fibers, setting up event listeners, and joining. The solution to both of these problems is higher-level timing and synchronization constructs that will enhance the expressivity of Epistrophy, and which are under active development.

