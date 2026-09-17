import type { AppContext } from "@/app/appContext";
import { GALLERY_PROBLEMS, randomConvexPolygonPreview, requestRandomConvexPolygonProblem, type GalleryProblem } from "@/features/problem-gallery/problems";
import { el } from "@/ui/dom";

const IDLE = 3000,
  ITEM_W = 84,
  GAP = 8,
  CHROME = 16;
// how often the random item's thumbnail changes shape while hovered
const RESHUFFLE_MS = 700;
// a five-pip die in the thumbnail's top-right corner, in the thumbnails' own stroke style
const DIE_MARKUP = '<g class="problem-gallery__die"><rect x="45" y="2" width="13" height="13" rx="2.5"/><circle cx="48.5" cy="5.5" r="1.3"/><circle cx="54.5" cy="5.5" r="1.3"/><circle cx="51.5" cy="8.5" r="1.3"/><circle cx="48.5" cy="11.5" r="1.3"/><circle cx="54.5" cy="11.5" r="1.3"/></g>';
type Shape = Pick<GalleryProblem, "vertices" | "objectiveVector">;
function pointsAttribute(problem: Pick<GalleryProblem, "vertices">) {
  const minX = Math.min(...problem.vertices.map((v) => v.x));
  const maxX = Math.max(...problem.vertices.map((v) => v.x));
  const minY = Math.min(...problem.vertices.map((v) => v.y));
  const maxY = Math.max(...problem.vertices.map((v) => v.y));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  return problem.vertices.map((v) => `${(8 + ((v.x - minX) / width) * 44).toFixed(1)},${(36 - ((v.y - minY) / height) * 28).toFixed(1)}`).join(" ");
}
const shapeMarkup = (shape: Shape) => `<polygon points="${pointsAttribute(shape)}"/><line x1="30" y1="22" x2="${30 + shape.objectiveVector.x}" y2="${22 - shape.objectiveVector.y}"/>`;

// The random item's thumbnail reshuffles while hovered: two shape layers
// crossfade (SVG point lists cannot be transitioned, opacity can), a fresh
// region every RESHUFFLE_MS, so the motion itself says what the die says.
// Under reduced motion it reshuffles once per hover instead of cycling.
function attachReshuffle(button: HTMLButtonElement): () => void {
  const layers = button.querySelectorAll<SVGGElement>(".problem-gallery__shape");
  let front = 0;
  let timer: number | null = null;
  const reshuffle = () => {
    const back = 1 - front;
    layers[back]!.innerHTML = shapeMarkup(randomConvexPolygonPreview());
    layers[back]!.classList.remove("is-faded");
    layers[front]!.classList.add("is-faded");
    front = back;
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  button.addEventListener("pointerenter", () => {
    reshuffle();
    stop();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timer = window.setInterval(reshuffle, RESHUFFLE_MS);
    }
  });
  button.addEventListener("pointerleave", stop);
  return stop;
}
export function mountProblemGallery(parent: HTMLElement, ctx: AppContext) {
  let expanded = false;
  const root = el("div", {
    className: "problem-gallery",
    attrs: { "aria-label": "Problem gallery" },
  });
  parent.append(root);
  const toggle = el("button", {
    className: "problem-gallery__toggle",
    attrs: {
      type: "button",
      title: "Problem gallery",
      "aria-expanded": "false",
    },
  });
  toggle.innerHTML = '<svg class="problem-gallery__chevron" viewBox="0 0 12 8" aria-hidden="true"><polyline points="1 1 6 6 11 1" /></svg>';
  const items = el("div", {
    className: "problem-gallery__items",
    attrs: { "aria-hidden": "true" },
  });
  root.append(toggle, items);
  const stopReshuffles: Array<() => void> = [];
  for (const p of GALLERY_PROBLEMS) {
    const b = el("button", {
      className: "problem-gallery__item",
      attrs: { type: "button", title: p.name },
    });
    b.innerHTML = p.isRandom
      ? `<svg class="problem-gallery__thumb" viewBox="0 0 60 44" aria-hidden="true"><g class="problem-gallery__shape">${shapeMarkup(p)}</g><g class="problem-gallery__shape is-faded"></g>${DIE_MARKUP}</svg><span>${p.name}</span>`
      : `<svg class="problem-gallery__thumb" viewBox="0 0 60 44" aria-hidden="true">${shapeMarkup(p)}</svg><span>${p.name}</span>`;
    if (p.isRandom) stopReshuffles.push(attachReshuffle(b));
    b.addEventListener("click", () => {
      if (p.isRandom) {
        const generated = requestRandomConvexPolygonProblem();
        if (generated) ctx.actions.loadGalleryProblem(generated);
        return;
      }
      ctx.actions.loadGalleryProblem(p);
    });
    items.append(b);
  }
  const render = () => {
    const sw = ctx.getViewportSidebarWidth();
    root.className = `problem-gallery ${expanded ? "is-expanded" : ""}`.trim();
    root.style.left = `calc(${sw}px + (100vw - ${sw}px) / 2)`;
    root.style.setProperty("--problem-gallery-expanded-width", `min(${GALLERY_PROBLEMS.length * ITEM_W + Math.max(0, GALLERY_PROBLEMS.length - 1) * GAP + CHROME}px, calc(100vw - ${sw}px - 120px))`);
    toggle.setAttribute("aria-expanded", String(expanded));
    items.setAttribute("aria-hidden", String(!expanded));
  };
  let timer: number | null = window.setTimeout(() => {
    timer = null;
    expanded = true;
    document.removeEventListener("click", firstClick);
    render();
  }, IDLE);
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  function firstClick() {
    expanded = false;
    clearTimer();
    document.removeEventListener("click", firstClick);
    render();
  }
  document.addEventListener("click", firstClick);
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    clearTimer();
    document.removeEventListener("click", firstClick);
    expanded = !expanded;
    render();
  });
  render();
  return {
    update: render,
    destroy: () => {
      clearTimer();
      for (const stop of stopReshuffles) stop();
      document.removeEventListener("click", firstClick);
      root.remove();
    },
  };
}
