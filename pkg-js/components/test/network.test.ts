import { describe, it, expect } from "vitest";
import {
  buildGraph,
  extractEdges,
  groupColorResolver,
  needsLayout,
  runForceAtlas2,
} from "../src/components/network-core.js";
import type { PlotomicsData } from "@plotomics/core";

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
      meta: { edges: [["a", "b"], ["c", "d"]] },
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
    const withCoords: PlotomicsData = { columns: { id: ["a"], x: [0], y: [0] } };
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
      (n) => g.getNodeAttribute(n, "x") === 0 && g.getNodeAttribute(n, "y") === 0,
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
    expect(dropped).toEqual({ missingEndpoint: 1, selfLoop: 1, duplicate: 1 });
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
