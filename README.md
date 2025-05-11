Epistrophy is an experimental concurrent runtime for [synchronous
programming](https://en.wikipedia.org/wiki/Synchronous_programming_language)
on the Web. It introduces low-level primitives such as synchronous computations
and effects (that execute instantly), asynchronous computations, delays,
events, and logical threads (_fibers_) for concurrent execution.

⚠️ This is a work in progress and some features discussed below are in various
stages and design and implementation. ⚠️

The major benefit of the synchronous approach is to bring structure to
the current state of interactive programming on the Web. Dealing with callbacks,
event handlers, promises, async/await, CSS animations and transitions, and media
elements means that the state of an application is scattered all over its code
and must be tracked through _ad hoc_ mechanisms that require a lot of careful
bookkeeping. This is complex, error-prone, and therefore the source of many
small glitches or serious bugs. Introducing fibers provides a consistent way of
sequencing and repeting computations, whether they are synchronous or
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
