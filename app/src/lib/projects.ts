import type { Project, SessionRow, Thread } from "@shared/protocol";

// The Projects screen as pure functions: what to show, in what order, expanded
// or not. The screen only renders what these return. Type-only import, so
// nothing here needs a bundler to run under vitest — same rule as groups.ts.

/** Real projects first, machine-made ones after. The daemon already sorts this
 *  way; splitting it here is what lets the screen put a divider between them and
 *  keep the generated block collapsed without re-deriving the rule. */
export interface Split {
  real: Project[];
  generated: Project[];
}

export function splitProjects(projects: Project[]): Split {
  return {
    real: projects.filter((p) => !p.generated),
    generated: projects.filter((p) => p.generated),
  };
}

/**
 * Case-insensitive substring over what a person would type: the project's name
 * or path, or any thread's title inside it. A project whose *name* matches keeps
 * all its threads — you searched for the folder, not for something in it. A
 * project that matched only through a thread is narrowed to the threads that
 * matched, so the hit is not buried in sixty siblings.
 *
 * A blank query is not a filter.
 */
export function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  if (q === "") return projects;
  const out: Project[] = [];
  for (const p of projects) {
    if (p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) {
      out.push(p);
      continue;
    }
    const threads = p.threads.filter((t) => t.title.toLowerCase().includes(q));
    // threadCount follows the narrowed list: "12 of 60" would be a lie about a
    // filtered view, where the honest count is what the search actually found.
    if (threads.length > 0) out.push({ ...p, threads, threadCount: threads.length });
  }
  return out;
}

/** Anything in this project waiting on the user? Drives the amber edge on the
 *  project header, so a collapsed project can still say it needs you. */
export const projectNeedsYou = (p: Project): boolean => p.threads.some((t) => t.status === "waiting_on_user");

/** Threads running right now, for the header's live count. */
export const projectRunning = (p: Project): number => p.threads.filter((t) => t.status === "running").length;

/**
 * Which projects start expanded.
 *
 * Opening on 60 collapsed rows makes the user work before they can read
 * anything, and opening all of them buries the top of the list. So: every
 * project with something waiting (that is the whole point of the app), plus the
 * most recent one so the screen is never all-collapsed. Searching expands
 * everything — you already said what you were looking for.
 */
export function initialExpanded(projects: Project[], searching: boolean): Set<string> {
  if (searching) return new Set(projects.map((p) => p.path));
  const open = new Set(projects.filter(projectNeedsYou).map((p) => p.path));
  const first = projects.find((p) => !p.generated) ?? projects[0];
  if (first !== undefined) open.add(first.path);
  return open;
}

/** How many threads a project is hiding behind its cap, or 0. The daemon sends
 *  the newest few and the true total; the difference is what the row must own up
 *  to rather than pretend fifty is all of them. */
export const hiddenThreads = (p: Project): number => Math.max(0, p.threadCount - p.threads.length);

/** Threads shown before an expanded project starts burying the ones after it.
 *  Eight is about a screen: enough to see what a project has been doing, few
 *  enough that the next project is still reachable by scrolling rather than by
 *  giving up. */
export const PREVIEW_THREADS = 8;

/**
 * What an expanded project actually renders.
 *
 * A project with 63 threads pushed every other project off the screen — the
 * browse surface stopped being browsable at the first busy folder. So an
 * expanded project shows a preview until the user asks for the rest.
 *
 * `rest` counts against `threadCount`, not the loaded array, so it stays honest
 * about threads the daemon truncated as well as ones this screen is holding
 * back. `expandable` is false once the only thing left is on the PC — tapping
 * could not produce them, and a control that does nothing is worse than a label.
 */
export function previewThreads(p: Project, all: boolean): { shown: Thread[]; rest: number; expandable: boolean } {
  const shown = all ? p.threads : p.threads.slice(0, PREVIEW_THREADS);
  return {
    shown,
    rest: Math.max(0, p.threadCount - shown.length),
    expandable: shown.length < p.threads.length,
  };
}

/** A thread continued more than once. The count is forks *behind* the current
 *  one — "resumed twice", not "three files" — because that is what a person
 *  means when they say they picked the conversation back up. */
export const resumeCount = (t: Thread): number => Math.max(0, t.sessionIds.length - 1);

/**
 * A discovered thread as a session row, so a conversation opened from Projects
 * has the same header, folder actions and status as one the daemon started.
 *
 * Matched on any id in the lineage: a link or a notification can hold an older
 * fork's id, and all of them name the same conversation. The row reports the
 * newest leaf, which is the only id worth continuing from.
 */
export function threadAsSession(projects: Project[], sessionId: string): SessionRow | undefined {
  for (const p of projects) {
    for (const t of p.threads) {
      if (t.threadId !== sessionId && !t.sessionIds.includes(sessionId)) continue;
      return { sessionId: t.resumeId, agent: t.agent, cwd: t.cwd, title: t.title, status: t.status, updatedAt: t.updatedAt };
    }
  }
  return undefined;
}
