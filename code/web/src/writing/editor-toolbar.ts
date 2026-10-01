/** A single row of common actions. Extra commands stay in a native popover. */
export function editorToolbar(toolbar: HTMLElement) {
  const primary = ["add-image", "bold", "italic", "link", "bullets"];
  const labels: Record<string, string> = {
    "add-image": "+",
    bold: "B",
    italic: "I",
    link: "Link",
    bullets: "List",
  };
  const commands = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("[data-command]"));
  const more = document.createElement("button");
  more.type = "button";
  more.textContent = "⋯";
  more.setAttribute("aria-label", "More formatting");
  const menu = document.createElement("div");
  menu.id = "formatting-options";
  menu.popover = "auto";
  menu.className = "formatting-options";
  menu.setAttribute("aria-label", "More formatting");
  more.popoverTargetElement = menu;
  more.addEventListener("pointerdown", (event) => event.preventDefault());
  for (const id of primary) {
    const button = commands.find((command) => command.dataset.command === id)!;
    button.textContent = labels[id]!;
    button.title = button.getAttribute("aria-label")!;
    toolbar.appendChild(button);
  }
  for (const command of commands) {
    if (primary.includes(command.dataset.command!)) continue;
    menu.appendChild(command);
    command.addEventListener("click", () => menu.hidePopover());
  }
  toolbar.appendChild(more);
  toolbar.appendChild(menu);
  // The browser visual viewport follows the on-screen keyboard and browser chrome.
  const viewport = window.visualViewport;
  const position = () => {
    const inset = viewport
      ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      : 0;
    toolbar.style.setProperty("--keyboard-inset", `${inset}px`);
  };
  viewport?.addEventListener("resize", position);
  viewport?.addEventListener("scroll", position);
  position();
  return () => {
    viewport?.removeEventListener("resize", position);
    viewport?.removeEventListener("scroll", position);
  };
}
