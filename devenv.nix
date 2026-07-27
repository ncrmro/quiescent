{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    bun.enable = true;
  };

  packages = [
    # Playwright CLI plus a matching, Nix-managed browser bundle, for the
    # blog/wiki demo specs in code/web. Avoids npm browser downloads and
    # hard-coded Chromium paths on NixOS; do not run `playwright install`.
    pkgs.playwright-test
  ];

  env.PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
  env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";

  # `devenv up` (or `devenv up -d`) starts the editing UI. The OAuth-gated
  # app needs code/web/.dev.vars; the /demo routes (blog + wiki) need no
  # credentials and are what the Playwright specs drive. Port 4000 is
  # preferred, not pinned — astro falls forward when it is taken.
  processes.web.exec =
    "cd code/web && node node_modules/.bin/astro dev --host 0.0.0.0 --port 4000";
}
