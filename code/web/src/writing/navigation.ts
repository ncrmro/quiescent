/** Explicit New links start fresh; reloading /new resumes this tab's local draft. */
export function wireNewLinks() {
  document.querySelectorAll<HTMLAnchorElement>("[data-new-document]").forEach((link) => {
    link.addEventListener("click", () => {
      sessionStorage.removeItem(`quiescent-new:${link.dataset.newDocument}`);
    });
  });
}
