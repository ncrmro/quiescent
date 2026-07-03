{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    bun.enable = true;
  };

  # `devenv up` (or `devenv up -d`) starts the editing UI; needs
  # code/web/.dev.vars for OAuth credentials.
  processes.web.exec = "cd code/web && bun run dev";
}
