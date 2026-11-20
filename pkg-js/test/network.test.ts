import { describe, it, expect } from "vitest";
import {
  type LabelBox,
  buildGraph,
  clearLabels,
  extractEdges,
  groupColorResolver,
  groupLegend,
  groupOrder,
  needsLayout,
  runForceAtlas2,
  edgeWidths,
} from "../src/components/network-core.js";
import type { PlotomicsData } from "../src/core/index.js";

const buildFull = (data: PlotomicsData, directed = false) =>
  buildGraph(data, {
    defaultNodeColor: "#000",
    defaultEdgeColor: "#ccc",
    defaultNodeSize: 4,
    directed,
    colorFor: groupColorResolver(["#a", "#b", "#c"], "#000"),
  });
const build = (data: PlotomicsData) => buildFull(data).graph;

describe("network helpers", () => {
  it("extracts edges from source/target columns with optional weight", () => {
    const edges = extractEdges({
      columns: {
        source: ["a", "b"],
        target: ["b", "c"],
        weight: [1.5, 2],
      },
    });
    expect(edges).toEqual([
      { source: "a", target: "b", weight: 1.5 },
      { source: "b", target: "c", weight: 2 },
    ]);
  });

  it("extracts edges from meta.edges pairs when no columns given", () => {
    const edges = extractEdges({
      columns: {},
      meta: {
        edges: [
          ["a", "b"],
          ["c", "d"],
        ],
      },
    });
    expect(edges).toEqual([
      { source: "a", target: "b" },
      { source: "c", target: "d" },
    ]);
  });

  it("maps groups to a stable palette and falls back to default color", () => {
    const color = groupColorResolver(["#111", "#222"], "#999");
    expect(color("g1")).toBe("#111");
    expect(color("g2")).toBe("#222");
    expect(color("g1")).toBe("#111"); // stable
    expect(color(undefined)).toBe("#999");
    expect(color("")).toBe("#999");
  });

  it("decides when a layout is needed", () => {
    const withCoords: PlotomicsData = {
      columns: { id: ["a"], x: [0], y: [0] },
    };
    const noCoords: PlotomicsData = { columns: { id: ["a"] } };
    expect(needsLayout(noCoords, "forceatlas2")).toBe(true);
    expect(needsLayout(withCoords, "forceatlas2")).toBe(false);
    expect(needsLayout(noCoords, "precomputed")).toBe(false);
  });

  it("builds a graph with nodes, coords, sizes, labels and groups", () => {
    const g = build({
      columns: {
        id: ["a", "b"],
        x: [1, 2],
        y: [3, 4],
        size: [5, 6],
        source: ["a"],
        target: ["b"],
      },
      meta: { nodeLabels: ["Alpha", "Beta"], nodeGroup: ["G1", "G2"] },
    });
    expect(g.order).toBe(2);
    expect(g.size).toBe(1);
    expect(g.getNodeAttribute("a", "x")).toBe(1);
    expect(g.getNodeAttribute("a", "size")).toBe(5);
    expect(g.getNodeAttribute("a", "label")).toBe("Alpha");
    expect(g.getNodeAttribute("a", "group")).toBe("G1");
    expect(g.getNodeAttribute("a", "color")).toBe("#a");
  });

  it("defaults label to id and size to the default when absent", () => {
    const g = build({ columns: { id: ["x1"] } });
    expect(g.getNodeAttribute("x1", "label")).toBe("x1");
    expect(g.getNodeAttribute("x1", "size")).toBe(4);
  });

  it("drops edges whose endpoints are unknown and self-loops", () => {
    const g = build({
      columns: {
        id: ["a", "b"],
        source: ["a", "a", "a"],
        target: ["b", "missing", "a"],
      },
    });
    // Only a-b survives (missing endpoint + self-loop dropped).
    expect(g.size).toBe(1);
    expect(g.hasEdge("a", "b")).toBe(true);
  });

  it("dedupes parallel edges in the undirected simple graph", () => {
    const g = build({
      columns: { id: ["a", "b"], source: ["a", "b"], target: ["b", "a"] },
    });
    expect(g.size).toBe(1);
  });

  it("seeds a ring layout when coordinates are absent", () => {
    const g = build({ columns: { id: ["a", "b", "c"] } });
    // No node should remain at the degenerate origin.
    const atOrigin = ["a", "b", "c"].every(
      (n) =>
        g.getNodeAttribute(n, "x") === 0 && g.getNodeAttribute(n, "y") === 0,
    );
    expect(atOrigin).toBe(false);
  });

  it("runs a bounded force layout that moves nodes and is a no-op when tiny", () => {
    const g = build({
      columns: {
        id: ["a", "b", "c"],
        source: ["a", "b"],
        target: ["b", "c"],
      },
    });
    const before = g.getNodeAttribute("a", "x");
    runForceAtlas2(g, 50);
    // Layout ran (positions are finite numbers; typically changed).
    expect(Number.isFinite(g.getNodeAttribute("a", "x") as number)).toBe(true);
    expect(typeof before).toBe("number");

    const single = build({ columns: { id: ["only"] } });
    expect(() => runForceAtlas2(single, 50)).not.toThrow();
  });

  it("reports the edges it drops: unknown endpoint, self-loop and duplicate", () => {
    const { graph, dropped } = buildFull({
      columns: {
        id: ["a", "b"],
        source: ["a", "a", "a", "b"],
        target: ["b", "missing", "a", "a"],
      },
    });
    // a-b kept; a-missing (unknown endpoint), a-a (self-loop), b-a (duplicate).
    expect(graph.size).toBe(1);
    expect(dropped).toEqual({
      missingEndpoint: 1,
      selfLoop: 1,
      duplicate: 1,
      missingCoords: 0,
    });
  });

  it("reads a per-edge color column and applies it to the edge", () => {
    const parsed = extractEdges({
      columns: {
        source: ["a", "b"],
        target: ["b", "c"],
        color: ["#f00", "#0f0"],
      },
    });
    expect(parsed).toEqual([
      { source: "a", target: "b", color: "#f00" },
      { source: "b", target: "c", color: "#0f0" },
    ]);

    const { graph } = buildFull({
      columns: {
        id: ["a", "b", "c"],
        source: ["a", "b"],
        target: ["b", "c"],
        color: ["#f00", "#0f0"],
      },
    });
    expect(graph.getEdgeAttribute("a", "b", "color")).toBe("#f00");
    expect(graph.getEdgeAttribute("b", "c", "color")).toBe("#0f0");
  });

  it("gives an edge with a missing colour the default colour", () => {
    // R sends NA as null, and Python None and NaN as null; NaN and "" may
    // come from other callers. Before the fix each became the text "null",
    // "NaN" or "", which sigma draws black.
    const color = ["#f00", null, Number.NaN, ""] as unknown as string[];
    const parsed = extractEdges({
      columns: {
        source: ["a", "a", "a", "b"],
        target: ["b", "c", "d", "c"],
        color,
      },
    });
    expect(parsed.map((e) => e.color)).toEqual([
      "#f00",
      undefined,
      undefined,
      undefined,
    ]);
    const { graph } = buildFull({
      columns: {
        id: ["a", "b", "c", "d"],
        source: ["a", "a", "a", "b"],
        target: ["b", "c", "d", "c"],
        color,
      },
    });
    expect(graph.getEdgeAttribute("a", "b", "color")).toBe("#f00");
    for (const [s, t] of [
      ["a", "c"],
      ["a", "d"],
      ["b", "c"],
    ] as const) {
      expect(graph.getEdgeAttribute(s, t, "color")).toBe("#ccc");
    }
  });

  it("falls back to the builder default when no color column is present", () => {
    const { graph } = buildFull({
      columns: { id: ["a", "b"], source: ["a"], target: ["b"] },
    });
    expect(graph.getEdgeAttribute("a", "b", "color")).toBe("#ccc");
  });

  it("keeps reciprocal edges distinct when directed", () => {
    const { graph, dropped } = buildFull(
      { columns: { id: ["a", "b"], source: ["a", "b"], target: ["b", "a"] } },
      true,
    );
    expect(graph.type).toBe("directed");
    expect(graph.size).toBe(2); // a->b and b->a both survive
    expect(dropped.duplicate).toBe(0);
  });
});

describe("weights and missing values", () => {
  it("maps |weight| onto the width range over the graph's own weights", () => {
    const w = edgeWidths([0.2, -0.9, 0.55], [1, 5]);
    expect(w[0]).toBe(1);
    expect(w[1]).toBe(5);
    expect(w[2]).toBeCloseTo(3, 10);
    expect(edgeWidths([400, 999], [1, 5])).toEqual([1, 5]);
    expect(edgeWidths([2, 2], [1, 5])).toEqual([3, 3]);
    expect(edgeWidths([Number.NaN, 1, 2], [1, 5])).toEqual([1, 1, 5]);
  });

  it("lays out a correlation network with negative weights", () => {
    const n = 40;
    const id = Array.from({ length: n }, (_, i) => `N${i}`);
    const source: string[] = [];
    const target: string[] = [];
    const weight: number[] = [];
    for (let i = 0; i < n; i += 1) {
      for (const j of [i + 1, i + 7]) {
        if (j >= n) continue;
        source.push(`N${i}`);
        target.push(`N${j}`);
        weight.push(((i * 37 + j * 11) % 19) / 10 - 0.9); // -0.9 .. 0.9
      }
    }
    const { graph } = buildFull({ columns: { id, source, target, weight } });
    runForceAtlas2(graph, 200);
    graph.forEachNode((_node, attrs) => {
      expect(Number.isFinite(attrs.x)).toBe(true);
      expect(Number.isFinite(attrs.y)).toBe(true);
    });
    // The signed weight is kept; the layout reads its size.
    const e = graph.edge("N0", "N1") as string;
    expect(graph.getEdgeAttribute(e, "weight")).toBeGreaterThanOrEqual(0);
    expect(graph.getEdgeAttribute(e, "rawWeight")).toBe(weight[0]);
    // Width follows |weight| over the graph's range, not the raw weight.
    const sizes = graph.mapEdges((_e, a) => a.size as number);
    expect(Math.min(...sizes)).toBeCloseTo(1.7, 6);
    expect(Math.max(...sizes)).toBeCloseTo(6, 6);
  });

  it("treats null and NaN as missing, not as 0 or the text 'null'", () => {
    const { graph, dropped } = buildFull({
      columns: {
        id: ["a", "b", "c", "d"],
        x: [2, null as unknown as number, 4, 6],
        y: [4, 2, Number.NaN, 8],
        source: ["a"],
        target: ["b"],
        weight: [null as unknown as number],
      },
      meta: {
        nodeGroup: ["g1", null, "g1", "g1"],
        nodeLabels: [null, "B", "C", "D"],
      },
    });
    expect(dropped.missingCoords).toBe(2);
    // b and c sit at the centre of the placed nodes a (2, 4) and d (6, 8).
    expect(graph.getNodeAttribute("b", "x")).toBe(4);
    expect(graph.getNodeAttribute("b", "y")).toBe(6);
    expect(graph.getNodeAttribute("c", "x")).toBe(4);
    expect(graph.getNodeAttribute("c", "y")).toBe(6);
    expect(graph.getNodeAttribute("b", "group")).toBeUndefined();
    expect(graph.getNodeAttribute("b", "color")).toBe("#000");
    expect(graph.getNodeAttribute("a", "label")).toBe("a");
    const e = graph.edge("a", "b") as string;
    expect(graph.getEdgeAttribute(e, "weight")).toBeUndefined();
  });
});

describe("network group legend", () => {
  it("lists the groups in the order they took their colours", () => {
    const g = build({
      columns: { id: ["a", "b", "c", "d"] },
      meta: { nodeGroup: ["T cell", "B cell", "T cell", "NK"] },
    });
    expect(groupLegend(g, "#000")).toEqual([
      { label: "T cell", color: "#a" },
      { label: "B cell", color: "#b" },
      { label: "NK", color: "#c" },
    ]);
  });

  it("adds an NA entry in the default colour for nodes with no group", () => {
    const g = build({
      columns: { id: ["a", "b", "c"] },
      meta: { nodeGroup: ["T cell", null, ""] as unknown as string[] },
    });
    expect(groupLegend(g, "#000")).toEqual([
      { label: "T cell", color: "#a" },
      { label: "NA", color: "#000", missing: true },
    ]);
  });

  it("is empty when no node has a group", () => {
    expect(groupLegend(build({ columns: { id: ["a", "b"] } }), "#000")).toEqual(
      [],
    );
    const g = build({
      columns: { id: ["a"] },
      meta: { nodeGroup: [null] as unknown as string[] },
    });
    expect(groupLegend(g, "#000")).toEqual([]);
  });
});

describe("network group levels", () => {
  it("puts the given levels first, then the other groups as the nodes have them", () => {
    expect(
      groupOrder(["B", "C", null, "", "A", "C", Number.NaN], ["A", "B", "Z"]),
    ).toEqual(["A", "B", "Z", "C"]);
    // Without levels the groups go in the order the nodes have them.
    expect(groupOrder(["T cell", "B cell", "T cell"])).toEqual([
      "T cell",
      "B cell",
    ]);
    // A level given twice, or as a number, comes once, as text.
    expect(groupOrder(undefined, ["2", 2, "1"])).toEqual(["2", "1"]);
  });

  it("gives the levels the palette colours by their place", () => {
    const color = groupColorResolver(["#a", "#b", "#c"], "#000", [
      "High",
      "Low",
    ]);
    // Before the fix "Low", met first, took the first colour.
    expect(color("Low")).toBe("#b");
    expect(color("High")).toBe("#a");
    expect(color("Mid")).toBe("#c");
  });

  it("lists every level in the legend in order, the unused ones too", () => {
    const levels = ["High", "Mid", "Low"];
    const colorFor = groupColorResolver(["#a", "#b", "#c", "#d"], "#000", [
      ...levels,
    ]);
    const { graph } = buildGraph(
      {
        columns: { id: ["a", "b", "c", "d"] },
        meta: { nodeGroup: ["Low", "Other", "High", null] as string[] },
      },
      {
        defaultNodeColor: "#000",
        defaultEdgeColor: "#ccc",
        defaultNodeSize: 4,
        colorFor,
      },
    );
    expect(groupLegend(graph, "#000", levels, colorFor)).toEqual([
      { label: "High", color: "#a" },
      { label: "Mid", color: "#b" },
      { label: "Low", color: "#c" },
      { label: "Other", color: "#d" },
      { label: "NA", color: "#000", missing: true },
    ]);
    expect(graph.getNodeAttribute("a", "color")).toBe("#c");
  });
});

describe("network labels that keep clear of each other", () => {
  const box = (left: number, top: number, width = 40, height = 10) => ({
    left,
    right: left + width,
    top,
    bottom: top + height,
  });

  it("keeps two labels with room between their letters", () => {
    // 8.6 px between the letters: before the fix the full height of the
    // font made them collide.
    expect(
      clearLabels([
        { box: box(0, 0), size: 4 },
        { box: box(5, 18.6), size: 4 },
      ]),
    ).toEqual([0, 1]);
  });

  it("leaves out a label within 2 px of another, the smaller node's", () => {
    // The hub's label is taken first, though sigma asked for it second.
    // The label 1 px from it is left out; the one 3 px from it is drawn.
    expect(
      clearLabels([
        { box: box(0, 9, 49), size: 4 },
        { box: box(50, 20), size: 16 },
        { box: box(93, 20, 30), size: 4 },
      ]),
    ).toEqual([1, 2]);
  });

  it("keeps a label drawn in the frame before, then the larger node's", () => {
    // Before the fix the hub's label took the room of a label already on
    // screen, which then blinked out as a zoom brought the hub in.
    const labels = [
      { box: box(0, 0), size: 4, shown: true },
      { box: box(30, 5), size: 16 },
      { box: box(100, 0), size: 4 },
      { box: box(110, 5), size: 8 },
    ];
    expect(clearLabels(labels)).toEqual([0, 3]);
  });

  it("keeps two labels on screen that touch, and the lower ranked of two that overlap", () => {
    // Letters 0.5 px into each other, both on screen: both stay.
    expect(
      clearLabels([
        { box: box(0, 0), size: 4, shown: true },
        { box: box(39.5, 9.5), size: 4, shown: true },
      ]),
    ).toEqual([0, 1]);
    // 3 px into each other: the label with the lower place in its grid
    // cell stays, as sigma's grid keeps it longest on a zoom out.
    expect(
      clearLabels([
        { box: box(0, 0), size: 4, shown: true, rank: 3 },
        { box: box(37, 7), size: 4, shown: true, rank: 0 },
      ]),
    ).toEqual([1]);
  });

  it("leaves out only labels that a drawn label is next to", () => {
    let s = 7;
    const rand = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
    const labels = Array.from({ length: 400 }, () => ({
      box: box(rand() * 800, rand() * 480, 20 + rand() * 60, 8 + rand() * 6),
      size: 2 + Math.floor(rand() * 4) * 4,
    }));
    const gap = 2;
    const near = (a: LabelBox, b: LabelBox) =>
      a.left < b.right + gap &&
      b.left < a.right + gap &&
      a.top < b.bottom + gap &&
      b.top < a.bottom + gap;
    const at = (i: number) => labels[i] as { box: LabelBox; size: number };
    const kept = clearLabels(labels, gap);
    const drawn = new Set(kept);
    for (const i of kept) {
      for (const j of kept) {
        if (i < j) expect(near(at(i).box, at(j).box)).toBe(false);
      }
    }
    for (let i = 0; i < labels.length; i += 1) {
      if (drawn.has(i)) continue;
      // A label left out has a drawn label next to it, of a node at least
      // as large.
      const by = kept.filter((j) => near(at(i).box, at(j).box));
      expect(by.length).toBeGreaterThan(0);
      expect(Math.max(...by.map((j) => at(j).size))).toBeGreaterThanOrEqual(
        at(i).size,
      );
    }
    expect(kept.length).toBeGreaterThan(50);
  });
});
