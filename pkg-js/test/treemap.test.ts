import { describe, it, expect } from "vitest";
import {
  buildRows,
  buildHierarchy,
  topAncestorId,
  topLevelIds,
  tileFitsLabel,
  valueExtent,
  type TreeRow,
} from "../src/components/treemap.js";
import type { HierarchyRectangularNode } from "d3-hierarchy";
import type { PlotomicsData } from "../src/core/index.js";

// A tiny two-pathway hierarchy:
//   root
//   ├── P1 ── g1 (3), g2 (5)
//   └── P2 ── g3 (2)
function sampleData(): PlotomicsData {
  return {
    columns: {
      id: ["root", "P1", "P2", "g1", "g2", "g3"],
      parent: ["", "root", "root", "P1", "P1", "P2"],
      value: [0, 0, 0, 3, 5, 2],
    },
    meta: {
      labels: ["All", "Pathway 1", "Pathway 2", "Gene 1", "Gene 2", "Gene 3"],
    },
  };
}

describe("treemap helpers", () => {
  it("zips columns into rows and normalizes the root parent", () => {
    const rows = buildRows(sampleData());
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ id: "root", parent: "", label: "All" });
    expect(rows[3]).toMatchObject({
      id: "g1",
      parent: "P1",
      value: 3,
      label: "Gene 1",
    });
  });

  it("treats 'NA' / missing parent as the root marker", () => {
    const rows = buildRows({
      columns: { id: ["a", "b"], parent: ["NA", "a"], value: [0, 1] },
    });
    expect(rows[0]!.parent).toBe("");
    expect(rows[1]!.parent).toBe("a");
  });

  it("coerces non-finite / negative values to 0", () => {
    const rows = buildRows({
      columns: { id: ["a"], parent: [""], value: [Number.NaN] },
    });
    expect(rows[0]!.value).toBe(0);
  });

  it("falls back to id when meta.labels is absent", () => {
    const rows = buildRows({
      columns: { id: ["x"], parent: [""], value: [1] },
    });
    expect(rows[0]!.label).toBe("x");
  });

  it("returns [] when required columns are missing", () => {
    expect(buildRows({ columns: { id: ["a"] } })).toEqual([]);
    expect(buildRows({ columns: {} })).toEqual([]);
  });

  it("stratifies and sums internal-node values from leaves", () => {
    const root = buildHierarchy(buildRows(sampleData()));
    expect(root.data.id).toBe("root");
    expect(root.value).toBe(10); // 3 + 5 + 2
    const p1 = root.children!.find((c) => c.data.id === "P1")!;
    expect(p1.value).toBe(8); // 3 + 5
    // sort() puts the heavier child (P1) first.
    expect(root.children![0]!.data.id).toBe("P1");
  });

  it("resolves the top-level ancestor id for coloring", () => {
    const root = buildHierarchy(buildRows(sampleData()));
    const g1 = root.leaves().find((l) => l.data.id === "g1")!;
    const g3 = root.leaves().find((l) => l.data.id === "g3")!;
    expect(topAncestorId(g1)).toBe("P1");
    expect(topAncestorId(g3)).toBe("P2");
    // The root itself maps to its own id.
    expect(topAncestorId(root)).toBe("root");
  });

  it("gates labels on minimum tile side", () => {
    const big = {
      x0: 0,
      y0: 0,
      x1: 50,
      y1: 40,
    } as HierarchyRectangularNode<TreeRow>;
    const thin = {
      x0: 0,
      y0: 0,
      x1: 50,
      y1: 10,
    } as HierarchyRectangularNode<TreeRow>;
    expect(tileFitsLabel(big, 32)).toBe(true);
    expect(tileFitsLabel(thin, 32)).toBe(false);
  });

  it("computes a value extent, handling degenerate input", () => {
    const leaves = [
      { value: 2 },
      { value: 8 },
      { value: 5 },
    ] as HierarchyRectangularNode<TreeRow>[];
    expect(valueExtent(leaves)).toEqual([2, 8]);
    expect(
      valueExtent([{ value: 4 }] as HierarchyRectangularNode<TreeRow>[]),
    ).toEqual([4, 5]);
    expect(valueExtent([])).toEqual([0, 1]);
  });
});

describe("treemap sizes and groups", () => {
  it("weighs every leaf as 1 when there is no value column", () => {
    const data = sampleData();
    delete (data.columns as Record<string, unknown>).value;
    const root = buildHierarchy(buildRows(data));
    expect(root.value).toBe(3); // three leaves
    expect(root.children?.find((c) => c.data.id === "P1")?.value).toBe(2);
  });

  it("ignores values given on internal nodes", () => {
    const data = sampleData();
    (data.columns as Record<string, unknown>).value = [10, 8, 2, 3, 5, 2];
    const root = buildHierarchy(buildRows(data));
    // Leaves only: 3 + 5 + 2. Before, the root and pathway values were added.
    expect(root.value).toBe(10);
    expect(root.children?.find((c) => c.data.id === "P1")?.value).toBe(8);
  });

  it("maps every node to its top-level group on the full tree", () => {
    const root = buildHierarchy(buildRows(sampleData()));
    const top = topLevelIds(root);
    expect(top.get("g1")).toBe("P1");
    expect(top.get("g2")).toBe("P1");
    expect(top.get("g3")).toBe("P2");
    expect(top.get("P2")).toBe("P2");
  });
});
