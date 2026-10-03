import { localDrafts } from "@quiescent/editor/local-drafts";
import type { DocumentDraft } from "@quiescent/server/contracts";
import { cacheLabel, fetchListing, matchesSearch } from "./listing-view";

function postRow(collection: string, draft: DocumentDraft) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = `/${collection}/${draft.document.id}/edit`;
  const label = draft.branch === "" ? "Local" : draft.state;
  link.textContent = `${String(draft.document.frontmatter.title || "Untitled")} — ${label}`;
  item.appendChild(link);
  const description = document.createElement("p");
  description.textContent = String(draft.document.frontmatter.description || "");
  item.appendChild(description);
  return item;
}
export async function mountDocumentList(section: HTMLElement) {
  const collection = section.dataset.collection!;
  const api = `/api/documents/${collection}`;
  const list = section.querySelector("ul")!;
  const status = section.querySelector<HTMLElement>("[role=status]")!;
  const freshness = section.querySelector<HTMLElement>("[data-cache-status]")!;
  const search = section.querySelector<HTMLInputElement>("[data-search]")!;
  const refresh = section.querySelector<HTMLButtonElement>("[data-refresh]")!;
  let documents = new Map(
    localDrafts(api)
      .list()
      .map((draft) => [draft.document.id, draft]),
  );
  let polls = 0;
  const render = () => {
    const visible = [...documents.values()]
      .filter((draft) => matchesSearch(draft, search.value))
      .sort((a, b) => a.document.createdAt.localeCompare(b.document.createdAt));
    list.replaceChildren(...visible.map((draft) => postRow(collection, draft)));
    status.textContent = `${visible.length} of ${documents.size} documents · Oldest first`;
  };
  search.addEventListener("input", render);
  render();
  async function load(force = false) {
    section.setAttribute("aria-busy", "true");
    refresh.disabled = true;
    try {
      const saved = await fetchListing(api, force);
      documents = new Map(
        localDrafts(api)
          .list()
          .map((draft) => [draft.document.id, draft]),
      );
      for (const draft of saved.documents) documents.set(draft.document.id, draft);
      freshness.textContent = cacheLabel(saved.cache);
      render();
      if (saved.cache.refreshing && polls++ < 3) pollListing(section, () => load());
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not load documents.";
    } finally {
      section.setAttribute("aria-busy", "false");
      refresh.disabled = false;
    }
  }
  refresh.addEventListener("click", () => {
    polls = 0;
    void load(true);
  });
  await load();
}

function pollListing(section: HTMLElement, load: () => Promise<void>) {
  setTimeout(() => {
    if (section.isConnected) void load();
  }, 2000);
}
