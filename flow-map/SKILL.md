---
name: flow-map
disable-model-invocation: true
description: A component-and-connector view of a codebase, where every node is stateful or effectful and every flow of data or control is traced from its source to its sink.
---

# Flow Map

Trace two things, separately: the data flows, and the control flows. Each is walked out to both its ends -- back to the source where it enters the system, forward to the sink where it leaves.

The map shows the flows the code actually runs, not the ones it should.

No subagents.

## Glossary

What the map is made of:

- System: the code being mapped -- every entity that is neither surface nor IO. Written unmarked.
- Surface, also called the interface: the UI the codebase shows its user, or the API it serves its callers. Written `[name]`. A rendered component, a toast, a text field, an HTTP route, a CLI command, an RPC method, a published event. The surface is what the codebase serves and IO is what it uses, so an endpoint you answer is surface and an endpoint you call is IO. A codebase with no callers -- a cron job, a build step -- has no surface, and its flows run IO to IO.
- IO: what the machine reads and writes. Written `(name)`. A file, a database, a socket, a clock, a command's stdout, a spawned process.
- Hop: one arrow between two entities. `A -> B` is a data dependence, `A => B` a control dependence. Nothing is written on a hop; what crosses is named once, by the flow the hop belongs to.

What gets traced:

- Flow: one path followed hop by hop, from its source to its sink.
- Data flow: values moving, written `->`. Named in the domain nouns of the codebase being mapped. Direction is the direction the value travels, which is often opposite to the control dependence.
- Control flow: pure control, written `=>`. One occurrence outside the system -- a click, a timer, a file change, an incoming request -- carried through to the effect it produces. Traced as its own subject, not as an attachment to a data flow.
- Source: where a flow enters the system. Always surface or IO, named specifically: the component rather than `screen`, the route rather than `http`, the file rather than `disk`.
- Sink: where a flow leaves the system. Always surface or IO, named the same way.
- Source-to-sink rule: a complete flow runs from a source to a sink. A flow missing either is unresolved, and why it is missing is a finding.
- Unresolved flow: one that starts or stops in the system instead of at a source or a sink, marked with a `!` anywhere in its section name. Skips the source-to-sink check.

## Unresolved flows

A flow that starts or stops in the system is one of two things, and which one is the finding. Either that end exists and you have not found it yet -- keep tracing, backward from a missing source as readily as forward to a missing sink. Or the code has no such end, and then it has a name: a value written and never read is a dead store, a value that appears from nowhere is an unsourced value, and a listener that fires and changes nothing observable is unreachable. Each is written into the map as an html block beside its diagram.

Making the render error go away is not the goal. Marking a flow `!` is a finding, not a failure.

## Scope

The user sets the scope. Take it from the skill argument when one is given: a folder, a package, a branch diff, a feature, a single entity and its neighbours. When the argument is absent or partial, infer it from the conversation so far and state the scope you inferred in one line before starting.

Scope picks the flows: trace a flow that runs through the scope, and leave every other one off the map. It does not bound the tracing itself -- a flow it picks is walked to both its ends, however far outside the scope that goes.

## What earns a node

An entity is stateful or effectful. Two kinds, and a thing earns a node when it is one of them:

- State: an object that holds state -- a cache, a queue, a registry, a connection, a subscription, an in-memory store. A consolidated state holds several of them together.
- IO: values come out of it or land in it or pass through it -- a file, a process command, a remote endpoint, a database, a clock, a terminal, the screen the user is looking at. The entity that owns the handle is IO, and so is the file or the command at the end of it.

Pure code gets no node. A collection of functions, a pure transform, a type declaration, a constant table and a value object are all neither stateful nor effectful. A class whose methods never read or write instance state is a collection of functions wearing a class.

Effects do not travel up the call stack. A function that calls an effectful entity is a hop into it, not a node of its own: `saveOrder()` calling `orderStore.write()` is the arrow into `OrderStore`.

## Steps

1. Inventory. Go file by file through the scope and decide, for each class, object and function a file exports, whether it earns a node. Done when every file in scope has been read and every export it holds is either a node or rejected. The map is built out of flows, not out of this list.

2. List the data flows the scope touches, and list the control flows it touches. Two lists, drawn up separately.

3. Walk each data flow out from the state you found it at, in both directions: forward to the sink, backward to the source.

   A value can reach several sinks and be fed by several sources, so follow every branch in both directions. Done when every branch forward ends at a sink and every branch backward ends at a source, or the flow is marked unresolved.

4. Trace the indirect hops. Callbacks, event emitters, subscriptions, queues, signals and stores, context providers, singletons created at file scope and imported instances all carry control and data with no call expression to grep for. Match each publisher to its subscribers by the channel they share.

5. Walk each control flow the same way. It starts at a source outside -- someone clicked, a timer fired, a watcher woke, a request arrived -- and ends at a sink outside, which may be a value moving, a process spawned, a screen repainted, or nothing at all. One that ends at nothing is unreachable.

   Where a control flow triggers a data flow, both are drawn. A data flow with no such trigger in the code -- a value read at import time, a value fetched partway along another flow -- gets no control flow, and inventing one draws a trigger the code does not have. Done when every control flow on the list has been walked.

6. Repeat 2 through 5 on every entity a flow newly passes through, until a full pass turns up no new flow or hop.

7. Write the map as a flow list: `#` names the project, `##` starts a diagram, `###` starts a data flow or a control flow, one line per hop. `FORMAT.md` has the whole grammar. Findings and prose go in fenced html blocks beside the diagram they belong to.

   Start with one diagram per flow, then group into one diagram the flows that run through the same entities or work the same way. A line is a single path, so a branch is written as its own flow: one per sink it reaches, one per source it comes from.

8. Render it:

   ```
   node flow-map.mts map.md -o map.html --open
   ```
