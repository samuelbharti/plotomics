/**
 * The script of the landing page: the copy buttons, and the live demo. Each
 * demo tab loads its plot on demand, in a chunk of its own. The first plot
 * loads when the demo scrolls into view, and a tab switch destroys the plot
 * it replaces, so one plot is live at a time.
 */
import type { PlotomicsInstance } from "../../pkg-js/src/core/index.js";
import type { DemoMount } from "./demo-types.js";

type Loader = () => Promise<{ mount: DemoMount }>;

const LOADERS: Record<string, Loader> = {
  embedding: () => import("./demo-embedding.js"),
  volcano: () => import("./demo-volcano.js"),
  oncoplot: () => import("./demo-oncoplot.js"),
  lollipop: () => import("./demo-lollipop.js"),
  km: () => import("./demo-km.js"),
  network: () => import("./demo-network.js"),
  hic: () => import("./demo-hic.js"),
};

/** Copy a command or a code block, and say so for a screen reader. */
function setupCopyButtons(): void {
  const live = document.getElementById("copy-status");
  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    "button.copy",
  )) {
    btn.addEventListener("click", () => {
      const text =
        btn.dataset.copy ??
        btn.closest(".codeblock")?.querySelector("pre")?.textContent ??
        "";
      navigator.clipboard.writeText(text.trim()).then(
        () => {
          btn.classList.add("copied");
          if (live) live.textContent = "Copied to the clipboard.";
          window.setTimeout(() => {
            btn.classList.remove("copied");
            if (live) live.textContent = "";
          }, 1400);
        },
        () => {
          if (live) live.textContent = "The browser did not allow the copy.";
        },
      );
    });
  }
}

/** The tabs, the stage and the status line of the live demo. */
function setupDemo(): void {
  const root = document.getElementById("demo");
  const panel = root?.querySelector<HTMLElement>('[role="tabpanel"]');
  const stage = root?.querySelector<HTMLElement>(".demo-stage");
  const status = root?.querySelector<HTMLElement>(".demo-status");
  if (!root || !panel || !stage || !status) return;
  const tabs = [
    ...root.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].filter((tab) => (tab.dataset.demo ?? "") in LOADERS);
  if (tabs.length === 0) return;

  const fontFamily = getComputedStyle(document.body).fontFamily;
  let plot: PlotomicsInstance<unknown> | null = null;
  let sizer: ResizeObserver | null = null;
  // A tab chosen while another still loads wins: each load takes a ticket,
  // and a load whose ticket is no longer the latest mounts nothing.
  let ticket = 0;
  let started = false;

  const selected = () =>
    tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ??
    (tabs[0] as HTMLButtonElement);

  function clear(): void {
    sizer?.disconnect();
    sizer = null;
    plot?.destroy();
    plot = null;
    stage?.replaceChildren();
  }

  async function show(tab: HTMLButtonElement): Promise<void> {
    if (!stage || !status) return;
    started = true;
    ticket += 1;
    const mine = ticket;
    clear();
    const note = tab.dataset.note ?? "";
    stage.setAttribute("aria-busy", "true");
    status.textContent = "Loading the plot.";
    try {
      const load = LOADERS[tab.dataset.demo ?? ""] as Loader;
      const { mount } = await load();
      if (mine !== ticket) return;
      const host = document.createElement("div");
      host.className = "demo-host";
      stage.append(host);
      const made = mount(host, {
        theme: { fontFamily, fontSize: 13 },
        say(text) {
          if (mine === ticket) status.textContent = text ?? note;
        },
      });
      plot = made;
      // Size the plot to its box now and on every change, as the R and
      // Python hosts do. The embedding draws nothing until it is sized.
      sizer = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box && box.width > 0 && box.height > 0) {
          made.resize(box.width, box.height);
        }
      });
      sizer.observe(host);
      status.textContent = note;
    } catch (err) {
      if (mine !== ticket) return;
      clear();
      const why = err instanceof Error ? err.message : String(err);
      status.textContent = `This demo could not start in this browser (${why}).`;
    } finally {
      if (mine === ticket) stage.removeAttribute("aria-busy");
    }
  }

  function select(tab: HTMLButtonElement): void {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    }
    panel?.setAttribute("aria-labelledby", tab.id);
    void show(tab);
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      if (tab.getAttribute("aria-selected") !== "true" || !started) {
        select(tab);
      }
    });
    // Arrow keys, Home and End move the focus along the tabs; Enter or
    // Space opens the focused one. Opening on focus would load each plot
    // the focus passes over.
    tab.addEventListener("keydown", (event) => {
      const i = tabs.indexOf(tab);
      const n = tabs.length;
      const to: Record<string, number> = {
        ArrowRight: (i + 1) % n,
        ArrowLeft: (i - 1 + n) % n,
        Home: 0,
        End: n - 1,
      };
      const next = tabs[to[event.key] ?? -1];
      if (!next) return;
      event.preventDefault();
      for (const t of tabs) t.tabIndex = t === next ? 0 : -1;
      next.focus();
    });
  }

  // Load the first plot when the demo comes near the viewport.
  if ("IntersectionObserver" in window) {
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          seen.disconnect();
          if (!started) void show(selected());
        }
      },
      { rootMargin: "200px 0px" },
    );
    seen.observe(root);
  } else {
    void show(selected());
  }
}

setupCopyButtons();
setupDemo();
