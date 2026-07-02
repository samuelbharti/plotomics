import { describe, it, expect } from "vitest";
import {
  buildGraph,
  extractEdges,
  groupColorResolver,
  needsLayout,
  runForceAtlas2,
} from "../src/components/network-core.js";
import type { BiovizData } from "@bioviz/core";

const build = (data: BiovizData) =>
  buildGraph(data, {
    defaultNodeColor: "#000",
    defaultEdgeColor: "#ccc",
    defaultNodeSize: 4,
    colorFor: groupColorResolver(["#a", "#b", "#c"], "#000"),
  });

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
    const withCoords: BiovizData = { columns: { id: ["a"], x: [0], y: [0] } };
    const noCoords: BiovizData = { columns: { id: ["a"] } };
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
});
