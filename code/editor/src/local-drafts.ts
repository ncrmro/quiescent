import type { DocumentDraft, DocumentRecord } from "@quiescent/server/contracts";

/** Browser-only drafts have no Git branch or revision. */
export function localDrafts(api: string) {
  const prefix = `quiescent-local:${api}:`;
  return {
    save(document: DocumentRecord) {
      localStorage.setItem(`${prefix}${document.id}`, JSON.stringify(document));
    },
    remove(id: string) {
      localStorage.removeItem(`${prefix}${id}`);
    },
    list(): DocumentDraft[] {
      const drafts: DocumentDraft[] = [];
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(prefix)) continue;
        try {
          const document = JSON.parse(localStorage.getItem(key)!);
          if (
            typeof document.id !== "string" ||
            key !== `${prefix}${document.id}` ||
            typeof document.body !== "string" ||
            !document.frontmatter ||
            typeof document.createdAt !== "string"
          )
            continue;
          drafts.push({ document, branch: "", headSha: "", state: "draft" });
        } catch {
          /* Preserve malformed records for manual recovery. */
        }
      }
      return drafts;
    },
  };
}

/** Also works on HTTP Tailscale origins where randomUUID is unavailable. */
export function documentUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
