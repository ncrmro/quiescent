{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    bun.enable = true;
  };

  packages = [
    # Playwright CLI plus a matching, Nix-managed browser bundle, for the
    # writing example specs in code/web. Avoids npm browser downloads and
    # hard-coded Chromium paths on NixOS; do not run `playwright install`.
    pkgs.playwright-test
  ];

  env.PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
  env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";

  # The launcher allocates and records this checkout's port and reuses its server.
  processes.web.exec = "bun run dev:writing";
}
