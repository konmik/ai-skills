# Input format

The grammar of the flow list. `SKILL.md` holds the glossary; the terms below are all
defined there.

Headings for structure, one line per hop. Nothing else.

```
# Acme

## Order page
> Nothing here refreshes itself: three intervals inside the controller drive every read.

### Order status
- (payments api) -> PaymentClient -> OrderController -> [OrderCard]

### Address edits
- [AddressForm] => OrderController => WriteService => OrderStore
- [AddressForm] -> OrderController -> WriteService -> OrderStore -> (orders.db)

### Status poll
- (timer) => OrderController => PaymentClient => (payments api)
```

- Three heading levels, each with one job. `#` names the project and becomes the page
  title, once per file. `##` starts a diagram. `###` starts a section: one data flow or one control flow.
- `--title` overrides the `#` heading when you want the page called something else.
- `> text` is that diagram's caption. Repeat the line to continue it.
- `- A -> B` is a data hop: the value moves from A to B.
- `- A => B` is a control hop: A decides when B runs.
- Chain hops on one line and mix the arrows: `- (timer) => Controller -> [OrderCard]`.
- A section's lines are read in order, so the flow runs from the first entity named to the last.

## Data flows and control flows

A section carrying any `->` is a data flow. A section that is `=>` the whole way is a
control flow. Both are checked against the source-to-sink rule: a flow that begins or
ends in the system fails the render with the name of the flow and the entity it
stopped at. Marking the section unresolved skips that check:

```
### webhook payload!
- (webhook) -> PaymentClient
```

One diagram has to draw a flow whole, so a flow spread over two diagrams fails the
render. Repeat the hops you need in each diagram that tells the story, or split it
into two named flows.

## Outside the system

The system borders the surface on one side and IO on the other, and each border gets a
mark: `[name]` for the surface in the first column, `(name)` for IO in the last.

A flow runs from one side to the other. Which side an entity belongs on is a fact
about the entity, not about where it sits in a line: in
`(payments api) -> PaymentClient -> OrderController -> [OrderCard]` the api is written
first and drawn on the right, so that value comes in from the right and lands on the
left.

## Prose and markup

A fenced ```html block is copied into the page as-is, at the point it appears in the file.
Put one above a diagram to introduce it and one below to draw the conclusion; anything the
diagram cannot say -- a finding, a table, a before-and-after count -- goes there.

## Columns

`[surface]` is the first column, `(io)` the last. The system in between is read off the control
arrows: an entity sits one column right of whatever drives it, so the entity a controller calls
lands to its right, and the entity that calls back is a back edge drawn right to left.

Write each flow the way its action travels -- the screen, then the entity, then the file it
lands in. The order the flows appear in does not move the columns; the only thing it decides
is which arrow of a control loop is read as the one closing it, and that is the arrow written
last.

## Running

```
node flow-map.mts map.md -o map.html --open --title "My app"
```

Node 22.18 or newer runs the TypeScript directly -- no build step, no `node_modules`.
