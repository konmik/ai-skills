#!/usr/bin/env node
// Turns a flow list into a flow map. See FORMAT.md.
//   node flow-map.mts map.md -o map.html [--open]
// Runs on Node 22.18+ with no build step and no dependencies: the runtime
// strips the types itself, so every construct here is erasable.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Kind = "control" | "data";

type Step = { a: string; b: string; kind: Kind };
type Flow = { name: string; steps: Step[] };
type Diagram = { title: string; caption: string; flows: Flow[] };
type Block = { kind: "diagram"; diagram: Diagram } | { kind: "html"; html: string };
type Legend = { control: string; data: string };
type World = { surface: Set<string>; io: Set<string> };
type Parsed = { title: string; blocks: Block[]; world: World; legend: Legend };

type Col = { x: number; w: number; gap: number };
type Entity = { id: string; label: string; col: number; h: number; side?: "surface" | "io" };
type Seam = { a: string; b: string; control?: 1; controlBA?: 1; dataAB?: 1; dataBA?: 1 };
type Panel = { title: string; caption: string; cols: Col[]; nodes: Entity[]; seams: Seam[] };
type Chain = { name: string; chain: string[]; pairs: string[]; event?: 1; open?: 1 };
type Section = { t: "d"; i: number } | { t: "h"; html: string };
type Model = {
  diagrams: Panel[];
  flows: Chain[];
  labels: Record<string, string>;
  sections: Section[];
  legend: Legend;
};

/* ---------------------------------------------------------------- parsing */

const DEFAULT_LEGEND: Legend = {
  control: "control dependence &mdash; who decides when it runs",
  data: "data dependence &mdash; values crossing, arrow follows the value",
};

// A section carrying data is a data flow, a section that is control the whole way is a
// control flow, and the two are independent: control often causes data to move, but a
// value can travel with no control flow driving it, and a control flow can move no data.

type Token =
  | { t: "heading"; level: number; text: string }
  | { t: "line"; text: string; raw: string }
  | { t: "html"; html: string };

// Fenced blocks are lifted out first so a "#" inside one stays markup.
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let fence: string[] | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (fence) {
      if (/^```/.test(line)) {
        tokens.push({ t: "html", html: fence.join("\n") });
        fence = undefined;
      } else fence.push(raw);
      continue;
    }
    const open = line.match(/^```+\s*(\w*)\s*$/);
    if (open) {
      if (open[1] && open[1].toLowerCase() !== "html")
        throw new Error(`Only \`\`\`html blocks are understood, not \`\`\`${open[1]}.`);
      fence = [];
      continue;
    }
    if (!line || line.startsWith("//")) continue;
    const head = line.match(/^(#+)\s*(.+)$/);
    if (head) tokens.push({ t: "heading", level: head[1].length, text: head[2].trim() });
    else tokens.push({ t: "line", text: line, raw });
  }
  if (fence) throw new Error("An html block is never closed with ```.");
  return tokens;
}

// Both borders of the system get a mark: `[name]` is the surface, the UI it shows
// and the API it serves, `(name)` is what the machine
// reads and writes -- a file, a database, a CLI, a clock. Everything unmarked is the
// system itself.
function parseSteps(line: string, world: World): Step[] {
  const parts = line.slice(1).split(/(=>|->)/).map((s) => s.trim());
  if (parts.length < 3) throw new Error(`Step "${line}" needs at least one -> or =>.`);
  const node = (raw: string) => {
    const surface = raw.match(/^\[(.+)\]$/), io = raw.match(/^\((.+)\)$/);
    if (!surface && !io) return raw;
    const name = (surface ?? io)![1].trim();
    (surface ? world.surface : world.io).add(name);
    return name;
  };
  const steps: Step[] = [];
  for (let i = 0; i + 2 < parts.length + 1; i += 2) {
    const from = parts[i], op = parts[i + 1], to = parts[i + 2];
    if (!op) break;
    if (!from || !to) throw new Error(`Step "${line}" has an empty entity name.`);
    steps.push({ a: node(from), b: node(to), kind: op === "=>" ? "control" : "data" });
  }
  return steps;
}

// Three heading levels, each with one job: "#" is the project, "##" is a diagram,
// "###" is a data flow or a control flow inside it.
function parse(text: string): Parsed {
  const tokens = tokenize(text);
  const blocks: Block[] = [];
  const world: World = { surface: new Set(), io: new Set() };
  let title: string | undefined;
  let diagram: Diagram | undefined;
  let flow: Flow | undefined;

  for (const token of tokens) {
    if (token.t === "html") {
      blocks.push({ kind: "html", html: token.html });
      continue;
    }
    if (token.t === "heading") {
      if (token.level === 1) {
        if (title) throw new Error(
          `Second "#" heading "${token.text}". One "#" names the project; a diagram is "##".`);
        title = token.text;
      } else if (token.level === 2) {
        diagram = { title: token.text, caption: "", flows: [] };
        blocks.push({ kind: "diagram", diagram });
        flow = undefined;
      } else if (token.level === 3) {
        if (!diagram) throw new Error(`Flow "${token.text}" appears before any "##" diagram heading.`);
        flow = { name: token.text, steps: [] };
        diagram.flows.push(flow);
      } else {
        throw new Error(
          `Heading "${token.text}" is ${token.level} levels deep. ` +
          '"#" is the project, "##" a diagram, "###" a data flow or a control flow.');
      }
      continue;
    }

    const line = token.text;
    if (line.startsWith(">")) {
      if (!diagram) throw new Error('A caption line appears before any "##" diagram heading.');
      diagram.caption += (diagram.caption ? " " : "") + line.slice(1).trim();
      continue;
    }
    if (line.startsWith("-")) {
      if (!flow) throw new Error(`Step "${line}" appears before any "###" flow heading.`);
      flow.steps.push(...parseSteps(line, world));
      continue;
    }
    throw new Error(`Cannot read line: ${token.raw}`);
  }

  if (!title) throw new Error('No "#" heading found. One "#" line names the project the map is of.');
  if (!blocks.some((b) => b.kind === "diagram")) throw new Error('No "##" diagram heading found.');
  if (!world.surface.size && !world.io.size)
    throw new Error("Every entity is unmarked, so the whole map is system and no flow " +
      "can cross it. Wrap the surface in brackets -- [OrderCard] -- and what the machine " +
      "reads and writes in parentheses -- (orders.db), (git).");
  return { title, blocks, world, legend: DEFAULT_LEGEND };
}

/* --------------------------------------------------------------- layering */

const id = (name: string) =>
  "n" + [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

// Layering can only walk a graph with no cycles in it, so a cycle has to be broken
// before the columns are counted -- the cycle removal phase every layered drawing
// starts with. Only an arrow that actually closes a loop may go: a depth-first walk
// in written order takes the first arrow of a loop as a tree edge and leaves the one
// closing it as the back edge, so a loop still keeps the arrow written first, while
// an arrow that closes nothing survives however late the entity it points at was
// first mentioned.
function acyclic(nodes: string[], edges: Step[]): Step[] {
  const from = new Map(nodes.map((n) => [n, [] as Step[]]));
  for (const e of edges) from.get(e.a)!.push(e);
  const OPEN = 1, DONE = 2;
  const state = new Map<string, number>();
  const back = new Set<Step>();
  const walk = (n: string) => {
    state.set(n, OPEN);
    for (const e of from.get(n)!) {
      const at = state.get(e.b);
      if (at === OPEN) back.add(e);             // closes a loop; this is the one to drop
      else if (at !== DONE) walk(e.b);
    }
    state.set(n, DONE);
  };
  for (const n of nodes) if (!state.has(n)) walk(n);
  return edges.filter((e) => !back.has(e));
}

// Columns come from the arrows and nothing else, and it is control that sets the
// direction: a control arrow always points away from whoever started the work, so
// following it walks from the thing that acted towards the thing acted upon. Data
// cannot set direction, because a value read and a value written cross the same
// seam in opposite directions -- which is also why the order the flows are written
// in cannot be allowed to decide the columns. So control lays out the map, and a
// node no control arrow touches -- a file, a socket, anything that only ever
// receives or yields a value -- lands one column past whatever hands it that value.
function layer(nodes: string[], steps: Step[], world: World) {
  const edges = steps.filter((s) => s.a !== s.b);
  const inside = (n: string) => !world.surface.has(n) && !world.io.has(n);
  const driven = acyclic(
    nodes.filter(inside),
    edges.filter((s) => s.kind === "control" && inside(s.a) && inside(s.b)),
  );

  // The system has two borders and the map has two frames: the surface in the first
  // column, what the machine reads and writes in the last, and the system in
  // between, each entity one column right of whatever drives it.
  const col: Record<string, number> = {};
  for (const n of nodes) col[n] = world.surface.has(n) ? 0 : 1;
  for (let pass = 0; pass < nodes.length; pass++)
    for (const s of driven)
      col[s.b] = Math.max(col[s.b], col[s.a] + 1);

  const code = nodes.filter(inside);
  const last = (code.length ? Math.max(...code.map((n) => col[n])) : 0) + 1;
  for (const n of nodes) if (world.io.has(n)) col[n] = last;

  const used = [...new Set(nodes.map((n) => col[n]))].sort((a, b) => a - b);
  nodes.forEach((n) => { col[n] = used.indexOf(col[n]); });
  return { col, columns: used.length };
}

/* ---------------------------------------------------------------- shaping */

function panel(d: Diagram, index: number, world: World, labels: Record<string, string>): Panel {
  const steps = d.flows.flatMap((f) => f.steps);
  const names = [...new Set(steps.flatMap((s) => [s.a, s.b]))];
  const { col, columns } = layer(names, steps, world);

  const width = (c: number) => Math.min(210, Math.max(96,
    Math.max(...names.filter((n) => col[n] === c).map((n) => n.length)) * 6.4 + 22));
  const cols: Col[] = [];
  let x = 14;
  for (let c = 0; c < columns; c++) { cols.push({ x, w: width(c), gap: 16 }); x += width(c) + 62; }

  const nodes: Entity[] = names.map((n) => ({
    id: id(n), label: n, col: col[n], h: 32,
    side: world.surface.has(n) ? "surface" as const : world.io.has(n) ? "io" as const : undefined,
  }));
  names.forEach((n) => { labels[id(n)] = n; });

  const seams = new Map<string, Seam>();
  for (const s of steps) {
    const forward = col[s.a] <= col[s.b];
    const [a, b] = forward ? [s.a, s.b] : [s.b, s.a];
    const key = a + " " + b;
    const seam = seams.get(key) ?? { a: id(a), b: id(b) };
    if (s.kind === "control") { if (forward) seam.control = 1; else seam.controlBA = 1; }
    else { if (forward) seam.dataAB = 1; else seam.dataBA = 1; }
    seams.set(key, seam);
  }

  return {
    title: `${index + 1} · ${d.title}`, caption: d.caption, cols, nodes, seams: [...seams.values()],
  };
}

// A data flow is its own path, source to sink. A control hop starting outside that
// path is not part of it -- it is what drives it.
// A section carrying data is a data flow; one that is control the whole way is a control flow.
// Either way it runs from a source to a sink, and a "!" in the name is how you say
// you know it does not yet.
function chainOf(f: Flow, world: World): Chain {
  const seq = f.steps.filter((s) => s.kind === "data");
  const event = seq.length ? undefined : (1 as const);
  const path = seq.length ? seq : f.steps;
  for (let k = 1; k < path.length; k++)
    if (path[k - 1].b !== path[k].a)
      throw new Error(
        `Flow "${f.name}" jumps from ${path[k - 1].b} to ${path[k].a}. ` +
        "A flow has one path; split this into two sections.");

  const chain = [path[0].a, ...path.map((s) => s.b)];
  const open = f.name.includes("!") ? (1 as const) : undefined;
  // Keyed by direction as well as by pair: a value going out and the answer coming
  // back cross the same seam, and they are not the same line.
  const keys = f.steps.map((s) => `${s.kind[0]}:${id(s.a)}>${id(s.b)}`);
  if (!open)
    for (const [end, missing, verb] of [
      [chain[0], "source", "starts"], [chain[chain.length - 1], "sink", "ends"],
    ])
      if (!world.surface.has(end) && !world.io.has(end))
        throw new Error(
          `"${f.name}" has no ${missing}: it ${verb} at ${end}, which is in the ` +
          `system. Follow it out to [surface] or to (io) -- a file, a database, a CLI, a ` +
          `clock -- or mark it unresolved with a "!" in the name: "${f.name}!".`);

  return { name: f.name, chain: chain.map(id), pairs: keys, event, open };
}

function build(parsed: Parsed): Model {
  const labels: Record<string, string> = {};
  const diagrams: Panel[] = [];
  const flows: Chain[] = [];
  const sections: Section[] = [];

  for (const block of parsed.blocks) {
    if (block.kind === "html") { sections.push({ t: "h", html: block.html }); continue; }
    sections.push({ t: "d", i: diagrams.length });
    diagrams.push(panel(block.diagram, diagrams.length, parsed.world, labels));
    for (const f of block.diagram.flows) flows.push(chainOf(f, parsed.world));
  }

  // Every flow has to be drawn whole somewhere, or the chip for it would light a
  // path that stops in mid-air in the only diagram it is offered from.
  const drawn = diagrams.map((d) => {
    const set = new Set<string>();
    for (const s of d.seams) {
      if (s.control) set.add(`c:${s.a}>${s.b}`);
      if (s.controlBA) set.add(`c:${s.b}>${s.a}`);
      if (s.dataAB) set.add(`d:${s.a}>${s.b}`);
      if (s.dataBA) set.add(`d:${s.b}>${s.a}`);
    }
    return set;
  });
  for (const f of flows) {
    if (f.open) continue;
    const need = [...new Set(f.pairs.filter((p) => p.startsWith(f.event ? "c:" : "d:")))];
    if (!drawn.some((set) => need.every((p) => set.has(p))))
      throw new Error(
        `"${f.name}" is split across diagrams, so no one picture draws the whole ` +
        "flow. Put every hop of it in one diagram, or mark it unresolved with a " +
        `"!" in the name.`);
  }
  return { diagrams, flows, labels, sections, legend: parsed.legend };
}

/* --------------------------------------------------------------- emitting */

const RUNTIME = String.raw`
const CTRL = "#ffffff", DATA = "#58a6ff";
const pairKey = (a, b) => [a, b].sort().join('|');

function panelSvg(spec) {
  const cols = spec.cols, nodes = spec.nodes, seams = spec.seams;
  const byId = {}; nodes.forEach(n => byId[n.id] = n);

  const PORT = 16, deg = {};
  for (const s of seams) {
    if (byId[s.a].col === byId[s.b].col) continue;
    (deg[s.a] ||= { out: 0, in: 0 }).out++;
    (deg[s.b] ||= { out: 0, in: 0 }).in++;
  }
  nodes.forEach(n => {
    const d = deg[n.id] || { out: 0, in: 0 };
    n.h = Math.max(n.h, 16 + Math.max(d.out, d.in) * PORT);
  });

  cols.forEach((c, ci) => {
    let y = 0;
    nodes.filter(n => n.col === ci).forEach(n => { n.x = c.x; n.w = c.w; n.y = y; y += n.h + c.gap; });
    c.total = y - c.gap;
  });
  const H = Math.max(...cols.map(c => c.total));
  cols.forEach((c, ci) => nodes.filter(n => n.col === ci).forEach(n => n.y += (H - c.total) / 2));
  const top = 20;
  nodes.forEach(n => n.y += top);
  const width = cols[cols.length - 1].x + cols[cols.length - 1].w + 14;
  const height = H + top + 16;

  const mid = n => n.y + n.h / 2;
  const portOut = {}, portIn = {};
  function assign(key, other) {
    const g = {};
    for (const s of seams) {
      if (byId[s.a].col === byId[s.b].col) continue;
      (g[s[key]] ||= []).push(s);
    }
    for (const nid of Object.keys(g)) {
      const list = g[nid], n = byId[nid];
      list.sort((p, q) => mid(byId[p[other]]) - mid(byId[q[other]]));
      const step = list.length > 1 ? Math.min(PORT, (n.h - 12) / (list.length - 1)) : 0;
      // In above centre, out below it. Sharing the centre makes a value that only
      // passes through look like one line skewered across the entity, with the
      // arrowhead stranded in the middle of it.
      const first = mid(n) + (key === 'a' ? 7 : -7) - step * (list.length - 1) / 2;
      list.forEach((s, i) => { (key === 'a' ? portOut : portIn)[s.a + '>' + s.b] = first + i * step; });
    }
  }
  assign('a', 'b'); assign('b', 'a');
  const oy = s => portOut[s.a + '>' + s.b], iy = s => portIn[s.a + '>' + s.b];

  let out = '';
  for (const [side, caption] of [['surface', 'SURFACE'], ['io', 'FILES, COMMANDS, CLOCKS, NETWORK']]) {
    const group = nodes.filter(n => n.side === side);
    if (!group.length) continue;
    const x0 = Math.min(...group.map(n => n.x)) - 9;
    const y0 = Math.min(...group.map(n => n.y)) - 15;
    const x1 = Math.max(...group.map(n => n.x + n.w)) + 9;
    const y1 = Math.max(...group.map(n => n.y + n.h)) + 9;
    out += '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) +
      '" rx="9" fill="none" stroke="#3a4553" stroke-dasharray="4 4"/>' +
      '<text x="' + (x0 + 8) + '" y="' + (y0 + 11) + '" fill="#6e7b8a" font-size="9"' +
      ' letter-spacing="0.6">' + caption + '</text>';
  }
  for (const n of nodes) {
    out += '<g class="node" data-node="' + n.id + '">' +
      '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h +
      '" rx="6" fill="#1b222c" stroke="#4d5b6b"/>' +
      '<text x="' + (n.x + n.w / 2) + '" y="' + (n.y + n.h / 2 + 4) + '" fill="#e6edf3"' +
      ' font-size="11" font-weight="600" text-anchor="middle">' + n.label + '</text></g>';
  }

  // Orthogonal connector routing, the standard three stages (Wybrow, Marriott and
  // Stuckey; the same shape libavoid uses): lay an orthogonal visibility graph over
  // the obstacles, search it for the cheapest path with bends priced in, then nudge
  // shared paths apart. Routing around an entity is then a property of the graph rather
  // than a special case bolted onto a straight line. The nudging is the one stage that
  // cannot be done a leg at a time: the search prices bends and never company, so it is
  // only once every leg is routed that you can see which of them chose the same gutter.
  const GAP = 14, BEND = 60, SPREAD = 6.5, REACH = 16;
  // Every leg of every seam, since each one starts and ends on its own row and the
  // graph has to carry that row or the leg has nothing to attach to.
  const legsOf = s => [
    s.control && [CTRL, 'fwd', 'cp'], s.controlBA && [CTRL, 'back', 'cp'],
    s.dataAB && [DATA, 'fwd', 'dp'], s.dataBA && [DATA, 'back', 'dp'],
  ].filter(Boolean).map((leg, i, all) => leg.concat([(i - (all.length - 1) / 2) * 6.2]));

  // Two entities in one column get no ports, since ports are for the fan across a
  // gutter; such a seam leaves and arrives at the middle of the left edge.
  const stacked = s => byId[s.a].col === byId[s.b].col;
  const leaveY = s => stacked(s) ? mid(byId[s.a]) : oy(s);
  const arriveY = s => stacked(s) ? mid(byId[s.b]) : iy(s);

  const xsAll = new Set(), ysAll = new Set();
  for (const n of nodes) {
    xsAll.add(n.x - GAP); xsAll.add(n.x + n.w + GAP);
    ysAll.add(n.y - GAP); ysAll.add(n.y + n.h + GAP);
  }
  for (const s of seams)
    for (const [, , , off] of legsOf(s)) { ysAll.add(leaveY(s) + off); ysAll.add(arriveY(s) + off); }
  const XS = [...xsAll].sort((a, b) => a - b), YS = [...ysAll].sort((a, b) => a - b);

  const inside = (x, y) => nodes.some(n =>
    x > n.x - 1 && x < n.x + n.w + 1 && y > n.y - 1 && y < n.y + n.h + 1);
  const clearH = (x0, x1, y) => !nodes.some(n => y > n.y - 1 && y < n.y + n.h + 1 &&
    Math.min(x0, x1) < n.x + n.w - 1 && Math.max(x0, x1) > n.x + 1);
  const clearV = (y0, y1, x) => !nodes.some(n => x > n.x - 1 && x < n.x + n.w + 1 &&
    Math.min(y0, y1) < n.y + n.h - 1 && Math.max(y0, y1) > n.y + 1);

  function search(from, to, fromDir, toDir) {
    // Nodes are grid crossings plus the two ports; a state is a node reached going
    // horizontally or vertically, so a turn can be charged for.
    const pts = [from, to];
    for (const x of XS) for (const y of YS) if (!inside(x, y)) pts.push([x, y]);
    const key = p => p[0] + ',' + p[1];
    const index = {}; pts.forEach((p, i) => index[key(p)] ??= i);
    // A port leaves its entity sideways, so it joins the first grid column on that
    // side. Taking the nearest column outright can land inside the entity it just left.
    const near = (p, dir) => {
      let best = null;
      for (const x of XS)
        if ((x - p[0]) * dir > 0 && (best === null || Math.abs(x - p[0]) < Math.abs(best - p[0])))
          best = x;
      return best;
    };
    const adj = pts.map(() => []);
    const link = (i, j, cost, dir) => { adj[i].push([j, cost, dir]); adj[j].push([i, cost, dir]); };
    for (const y of YS) {
      const row = XS.filter(x => !inside(x, y));
      for (let i = 1; i < row.length; i++)
        if (clearH(row[i - 1], row[i], y))
          link(index[row[i - 1] + ',' + y], index[row[i] + ',' + y], row[i] - row[i - 1], 0);
    }
    for (const x of XS) {
      const colPts = YS.filter(y => !inside(x, y));
      for (let i = 1; i < colPts.length; i++)
        if (clearV(colPts[i - 1], colPts[i], x))
          link(index[x + ',' + colPts[i - 1]], index[x + ',' + colPts[i]], colPts[i] - colPts[i - 1], 1);
    }
    for (const [p, i, dir] of [[from, 0, fromDir], [to, 1, toDir]]) {
      const x = near(p, dir);
      if (x !== null && clearH(p[0], x, p[1]) && index[x + ',' + p[1]] !== undefined)
        link(i, index[x + ',' + p[1]], Math.abs(x - p[0]), 0);
    }

    const best = {}, seen = {};
    const queue = [[0, 0, -1, null]];                       // cost, node, dir, trail
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [cost, at, dir, trail] = queue.shift();
      if (seen[at + ':' + dir]) continue;
      seen[at + ':' + dir] = 1;
      if (at === 1) {
        const out = []; for (let t = { at, trail }; t; t = t.trail) out.unshift(pts[t.at]);
        return out;
      }
      for (const [to2, w, d] of adj[at]) {
        const c = cost + w + (dir >= 0 && d !== dir ? BEND : 0);
        if (best[to2 + ':' + d] !== undefined && best[to2 + ':' + d] <= c) continue;
        best[to2 + ':' + d] = c;
        queue.push([c, to2, d, { at, trail }]);
      }
    }
    return null;
  }

  function route(s, off) {
    const A = byId[s.a], B = byId[s.b];
    const same = stacked(s), rightwards = !same && A.col <= B.col;
    const from = [rightwards ? A.x + A.w : A.x, leaveY(s) + off];
    const to = [rightwards || same ? B.x : B.x + B.w, arriveY(s) + off];
    const found = search(from, to, rightwards ? 1 : -1, rightwards ? -1 : same ? -1 : 1)
      ?? [from, [(from[0] + to[0]) / 2, from[1]],
      [(from[0] + to[0]) / 2, to[1]], to];
    // A run through several grid crossings is one segment; keep only the corners.
    const bends = found.filter((p, i) => i === 0 || i === found.length - 1 ||
      (p[0] !== found[i - 1][0] || found[i + 1][0] !== p[0]) &&
      (p[1] !== found[i - 1][1] || found[i + 1][1] !== p[1]));
    return bends.map(p => p.slice());
  }

  // The vertical runs of one path that are free to move. The first and the last leg of
  // a path end on a port, and a port belongs to the entity rather than to the route, so
  // a run touching one is pinned. Shift a whole run, never one of its ends, or the path
  // stops being orthogonal and a diagonal cuts the corner off an entity.
  function runsOf(pts) {
    const runs = [];
    for (let i = 1; i + 2 < pts.length; i++)
      if (pts[i][0] === pts[i + 1][0])
        runs.push({
          pts, i, x: pts[i][0],
          y0: Math.min(pts[i][1], pts[i + 1][1]),
          y1: Math.max(pts[i][1], pts[i + 1][1]),
          // Where the run is headed, read off the horizontals on either side of it.
          toward: (pts[i - 1][0] + pts[i + 2][0]) / 2,
        });
    return runs;
  }

  // Sharing a gutter is only a problem where the runs also share vertical extent, and
  // that sharing is transitive: a run overlapping two others that miss each other still
  // has to be spread against both, or it lands back on top of one of them.
  function bundles(runs) {
    const out = [];
    let bundle = [], edge = -Infinity;
    for (const r of [...runs].sort((a, b) => a.y0 - b.y0)) {
      if (bundle.length && r.y0 > edge) { out.push(bundle); bundle = []; }
      bundle.push(r);
      edge = Math.max(edge, r.y1);
    }
    if (bundle.length) out.push(bundle);
    return out;
  }

  // How far a bundle may spread each way, probed against the same obstacles the search
  // routed around. A gutter running down open space fans much wider than one squeezed
  // against an entity, and one allowance for both would have to assume the worst.
  function room(x, y0, y1, dir) {
    let d = 0;
    while (d < REACH && clearV(y0, y1, x + (d + 1) * dir)) d++;
    return d;
  }

  // Ordered by where each run is headed, so a leg turning off early sits nearer the side
  // it leaves towards and the spreading crosses nothing that was not crossed already.
  function nudge(legs) {
    const gutters = new Map();
    for (const leg of legs)
      for (const run of runsOf(leg.pts)) {
        const key = Math.round(run.x);
        if (!gutters.has(key)) gutters.set(key, []);
        gutters.get(key).push(run);
      }
    for (const gutter of gutters.values())
      for (const bundle of bundles(gutter)) {
        if (bundle.length < 2) continue;
        bundle.sort((a, b) => a.toward - b.toward || a.y0 - b.y0);
        const x = bundle[0].x;
        const y0 = Math.min(...bundle.map((r) => r.y0));
        const y1 = Math.max(...bundle.map((r) => r.y1));
        const left = room(x, y0, y1, -1), right = room(x, y0, y1, 1);
        // Laid out across the room rather than around the gutter, so a bundle hard up
        // against an entity on one side still takes its full spread out of the open one.
        const span = Math.max(left + right, SPREAD);
        const step = Math.min(SPREAD, span / (bundle.length - 1));
        const first = x - left + (span - step * (bundle.length - 1)) / 2;
        bundle.forEach((r, k) => {
          const dx = first + k * step - r.x;
          r.pts[r.i][0] += dx;
          r.pts[r.i + 1][0] += dx;
        });
      }
  }
  function poly(pts, color, dir, cls, s) {
    return '<path class="' + cls + '" data-pair="' + pairKey(s.a, s.b) + '" data-a="' + s.a +
      '" data-b="' + s.b + '" data-dir="' + dir + '" d="' +
      pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ') +
      '" fill="none" stroke="' + color + '" stroke-width="1.5" marker-' +
      (dir === 'back' ? 'start="url(#ahs-' : 'end="url(#ah-') + (color === CTRL ? 'c' : 'd') + ')"/>';
  }

  const pairs = new Set(), legs = [];
  for (const s of seams) {
    if (s.control) pairs.add('c:' + s.a + '>' + s.b);
    if (s.controlBA) pairs.add('c:' + s.b + '>' + s.a);
    if (s.dataAB) pairs.add('d:' + s.a + '>' + s.b);
    if (s.dataBA) pairs.add('d:' + s.b + '>' + s.a);
    // Two legs of one seam are a value going out and the answer coming back, so
    // they leave on rows of their own to read as two lines with two arrowheads.
    for (const [color, dir, cls, off] of legsOf(s))
      legs.push({ s, color, dir, cls, pts: route(s, off) });
  }
  nudge(legs);
  for (const leg of legs) out += poly(leg.pts, leg.color, leg.dir, leg.cls, leg.s);

  const svg = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height +
    '"><defs>' +
    '<marker id="ah-c" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#ffffff"/></marker>' +
    '<marker id="ah-d" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#58a6ff"/></marker>' +
    '<marker id="ahs-c" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M8 0 L0 4 L8 8 z" fill="#ffffff"/></marker>' +
    '<marker id="ahs-d" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M8 0 L0 4 L8 8 z" fill="#58a6ff"/></marker>' +
    '</defs>' + out + '</svg>';
  return { svg, pairs };
}

const GROUPS = [];
for (const f of FLOWS) {
  const key = (f.event ? 'e:' : 'v:') + [...new Set(f.pairs)].sort().join(',');
  const g = GROUPS.find(x => x.key === key);
  if (g) { if (!g.names.includes(f.name)) g.names.push(f.name); g.open ||= f.open; }
  else GROUPS.push({
    key, names: [f.name], pairs: f.pairs, chain: f.chain, event: f.event, open: f.open,
  });
}
GROUPS.forEach(g => { g.label = g.names.join(', '); });
const byLabel = {};
GROUPS.forEach(g => (byLabel[g.label] ||= []).push(g));
Object.values(byLabel).filter(l => l.length > 1).forEach(list => {
  list.forEach(g => {
    const others = new Set(list.filter(x => x !== g).flatMap(x => x.chain));
    const uniq = g.chain.filter(n => !others.has(n));
    g.label += ' (' + LABEL[uniq[uniq.length - 1] ?? g.chain[g.chain.length - 2]] + ')';
  });
});

const rendered = DIAGRAMS.map(d => ({ d, ...panelSvg(d) }));
// A chip only appears where the whole flow is drawn. Listed against a diagram
// holding half of it, hovering lights a path that stops in mid-air and the value
// looks broken when it is only somewhere else.
const litKeys = g => g.pairs.filter(p => p.startsWith(g.event ? 'c:' : 'd:'));
const hits = GROUPS.map(g => {
  const need = [...new Set(litKeys(g))];
  return rendered.map(r => need.filter(p => r.pairs.has(p)).length === need.length);
});

function panelHtml(i) {
  const { d, svg } = rendered[i];
  const here = GROUPS.filter((g, j) => hits[j][i]);
  const row = (list, hint, cls) => list.length
    ? '<div class="chips"><span class="hint">' + hint + '</span>' + list.map(g =>
      '<span class="flow ' + cls + (g.open ? ' open' : '') + '" data-flow="' +
      GROUPS.indexOf(g) + '">' + g.label + '</span>').join('') + '</div>'
    : '';
  return '<div class="panel"><h3>' + d.title + '</h3>' +
    (d.caption ? '<p class="cap">' + d.caption + '</p>' : '') + svg +
    row(here.filter(g => !g.event), 'data flows &mdash; hover one, or hover any entity:', 'val') +
    row(here.filter(g => g.event), 'control flows &mdash; hover one:', 'evt') +
    '</div>';
}

document.getElementById('out').innerHTML = SECTIONS
  .map(s => s.t === 'd' ? panelHtml(s.i) : '<div class="raw">' + s.html + '</div>').join('');

const allSvgs = [...document.querySelectorAll('.panel svg')];
const allPaths = [...document.querySelectorAll('.panel svg path[data-pair]')];
const allNodes = [...document.querySelectorAll('.panel svg .node')];
const pinned = new Map();
let hovering = null;

// A selection lights the entities as well as the lines between them, since a flow is
// read as the entities it visits and lit arrows alone leave you tracing which ones they
// touched. The tone says which kind of chain lit it: blue for a value, white for an
// event, red for one still open.
function apply() {
  const on = [...pinned.values()].concat(hovering ? [hovering] : []);
  [...allPaths, ...allNodes].forEach(el => el.classList.remove('lit', 'litc', 'lito'));
  // Two states, and no third. A line is selected or it is not; whether anything
  // else happens to be selected is not a fact about this line.
  for (const sel of on)
    for (const el of sel.els) {
      el.classList.add('lit');
      if (sel.tone) el.classList.add(sel.tone);
      el.parentNode.appendChild(el);
    }
}
function bind(el, key, els, tone) {
  const sel = { els, tone };
  el.addEventListener('mouseenter', () => { hovering = sel; apply(); });
  el.addEventListener('mouseleave', () => { hovering = null; apply(); });
  el.addEventListener('click', () => {
    if (pinned.has(key)) { pinned.delete(key); el.classList.remove('pinned'); }
    else { pinned.set(key, sel); el.classList.add('pinned'); }
    apply();
  });
}
// A chip lights its own kind of line in its own panel: a data flow is blue, a control flow is
// white, and neither reaches across into a diagram you are not looking at. The leg
// has to match the direction too -- out and back share a seam but not a line.
for (const chip of document.querySelectorAll('.flow')) {
  const g = GROUPS[Number(chip.dataset.flow)];
  const panel = chip.closest('.panel'), cls = g.event ? 'cp' : 'dp';
  const paths = litKeys(g).flatMap(k => {
    const [from, to] = k.slice(2).split('>');
    return [...panel.querySelectorAll(
      'path.' + cls + '[data-pair="' + pairKey(from, to) + '"]')]
      .filter(p => (p.dataset.a === from) === (p.dataset.dir === 'fwd'));
  });
  const entities = [...new Set(g.chain)].flatMap(nid =>
    [...panel.querySelectorAll('.node[data-node="' + nid + '"]')]);
  bind(chip, 'f' + chip.dataset.flow, paths.concat(entities),
    g.open ? 'lito' : g.event ? 'litc' : '');
}
// An entity lights itself along with everything crossing it, in every panel it appears in.
for (const g of document.querySelectorAll('svg .node')) {
  const nid = g.dataset.node;
  bind(g, 'n' + nid, allSvgs.flatMap(s =>
    [...s.querySelectorAll('path[data-a="' + nid + '"], path[data-b="' + nid + '"]')])
    .concat(allNodes.filter(n => n.dataset.node === nid)), '');
}
`;

const CSS = `
  :root { --surface:#0d1117; --panel:#11161d; --ink:#e6edf3; --ink2:#9aa7b4; --ink3:#6e7b8a; --line:#2b3542; }
  * { box-sizing: border-box; }
  body { margin:0; padding:26px 22px 60px; background:var(--surface); color:var(--ink);
         font:13px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif; }
  h1 { font-size:19px; margin:0 0 10px; font-weight:600; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px;
           padding:12px 10px 8px; margin-bottom:18px; display:block; width:fit-content; }
  .panel h3 { margin:0 0 2px 6px; font-size:13px; font-weight:600; }
  .panel .cap { margin:0 0 8px 6px; font-size:11px; color:var(--ink3); max-width:760px; }
  .raw { margin:0 0 18px; max-width:1120px; }
  .legend { display:flex; gap:20px; flex-wrap:wrap; align-items:center; margin:4px 0 18px;
            font-size:12px; color:var(--ink2); }
  .legend span { display:inline-flex; align-items:center; gap:7px; }
  .sw { width:26px; height:0; border-top:2px solid; }
  .chip { display:inline-block; width:22px; height:12px; border:1px solid; }
  .chips { display:flex; flex-wrap:wrap; gap:5px; margin:10px 4px 2px; max-width:1120px; }
  .chips .hint { color:var(--ink3); font-size:11px; align-self:center; margin-right:2px; }
  .flow { display:inline-block; padding:2px 10px; border-radius:12px; border:1px solid #24303d;
          background:#141b23; cursor:default; font-size:11px; color:#7fb3e8; font-weight:600; }
  .flow:hover { border-color:#58a6ff; background:#18242f; }
  .flow.pinned { border-color:#58a6ff; background:#1d3350; color:#cfe4ff; }
  .flow.evt { color:#d6dee7; border-color:#33404e; }
  .flow.evt:hover { border-color:#ffffff; background:#1e252d; }
  .flow.evt.pinned { border-color:#ffffff; background:#2b333c; color:#ffffff; }
  .flow.open { color:#ff7b72; border-color:#5c2b28; background:#241618; }
  .flow.open:hover { border-color:#ff7b72; background:#301b1d; }
  .flow.open.pinned { border-color:#ff7b72; background:#4a2320; color:#ffd8d4; }
  svg .cp { opacity:.15; }
  svg .dp { opacity:.2; }
  svg .lit { opacity:1 !important; stroke-width:2.6; }
  svg .node { cursor:default; }
  svg .node:hover rect { stroke:#58a6ff; }
  svg .node.lit rect { stroke:#58a6ff; stroke-width:2; fill:#182430; }
  svg .node.lit text { fill:#ffffff; }
  svg .node.lit.litc rect { stroke:#ffffff; fill:#222932; }
  svg .node.lit.lito rect { stroke:#ff7b72; fill:#2a1719; }
`;

function html(model: Model, title: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head>
<body>
<h1>${title}</h1>
<div class="legend">
  <span><i class="sw" style="border-color:#ffffff"></i> ${model.legend.control}</span>
  <span><i class="sw" style="border-color:#58a6ff"></i> ${model.legend.data}</span>
</div>
<div id="out"></div>
<script>
const DIAGRAMS = ${JSON.stringify(model.diagrams)};
const FLOWS = ${JSON.stringify(model.flows)};
const LABEL = ${JSON.stringify(model.labels)};
const SECTIONS = ${JSON.stringify(model.sections)};
${RUNTIME}
</script>
</body></html>`;
}

/* ------------------------------------------------------------------- main */

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("-"));
if (!input) {
  console.error('usage: node flow-map.mts <map.md> [-o out.html] [--open] [--title "..."]');
  process.exit(1);
}
const outPath = resolve(args.includes("-o") ? args[args.indexOf("-o") + 1] : input.replace(/\.[^.]+$/, "") + ".html");

const parsed = parse(readFileSync(resolve(input), "utf8"));
const title = args.includes("--title") ? args[args.indexOf("--title") + 1] : parsed.title;
const model = build(parsed);
writeFileSync(outPath, html(model, title), "utf8");
const raw = model.sections.filter((s) => s.t === "h").length;
console.log(`${outPath}  (${model.diagrams.length} diagrams, ${model.flows.length} flows, ${raw} html blocks)`);

// Guest mode is what makes --open land on the map: a normal Chrome start on a
// machine with several profiles stops at the profile picker instead.
function findChrome(): string | undefined {
  const candidates = process.platform === "win32"
    ? [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p) => existsSync(p));
}

if (args.includes("--open")) {
  const url = pathToFileURL(outPath).href;
  const chrome = findChrome();
  const [cmd, cmdArgs] = chrome
    ? [chrome, ["--guest", url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  if (!chrome) console.warn("Chrome not found; opening in the default browser instead.");
  const child = spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" });
  child.on("error", (e) => console.error(`Could not open ${url}: ${e.message}`));
  child.unref();
}
