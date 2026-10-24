# Anti-slop installation

Installed for **hosting-manager only** on 2026-10-05 using the bundled Codex Skill Installer's pinned GitHub download. No application runtime dependency or database change is part of this setup.

- Source: [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop)
- Version: `3.2.20`
- Revision: [`388cbe3b6c37d5175b9f460015bb092ef9e34894`](https://github.com/miqdadbadjuber/anti-slop/tree/388cbe3b6c37d5175b9f460015bb092ef9e34894)
- Installed folders: `.agents/skills/antislop`, `antislop-ui`, `antislop-copywriting`, `antislop-human`, `antislop-layoutmobile`, and `antislop-code`.
- Upstream MIT license is included in each folder. `antislop/UPSTREAM.json` records provenance.

## How it is applied

`AGENTS.md` connects the installed files to applicable development tasks. The project default is **during**, without a repeated mode question. A direct user mode choice takes precedence. No global preference was changed.

`DESIGN.md` records the user's existing product direction. Project integration preserves that direction and current authorization instead of imposing upstream wizard prompts, new aesthetics, or unrelated work.

When the project itself is the working directory, Codex can discover `.agents/skills`. For sessions opened at `C:\voidproject`, the parent `AGENTS.md` routes hosting-manager work to the project instructions and installed files. Other projects do not inherit these defaults. Newly installed skills are available from the next turn; if the UI's skill picker is stale, reopen the project in a new session.

## Reviewed limitation

This revision misstates the large-text threshold and has rounding errors in its MCP contrast checker and self-test. The project instructions use the [W3C definition](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): 18pt regular or 14pt bold (or equivalent CJK size), and compare contrast before rounding.

The ordinary `contrast-check.py` CLI compares unrounded values correctly. Its normal/large verdicts are usable for the supported opaque HEX pairs. Its `--selftest` is insufficient to verify threshold behavior. `contrast-mcp.py` is retained as upstream source but is not registered and must not be used for decisions at this revision.

Useful boundary checks:

| Pair | Raw ratio, approximately | Normal text | Large text |
| --- | --- | --- | --- |
| `#000000` / `#FFFFFF` | 21 | PASS | PASS |
| `#070707` / `#777777` | 4.498348 | FAIL | PASS |
| `#000000` / `#595959` | 2.997975 | FAIL | FAIL |

## Updates and version control

Commit the project `AGENTS.md`, `DESIGN.md`, this document, and the installed `.agents/skills` files to share the setup. The workspace parent instruction is outside the hosting-manager repository; the project instruction remains sufficient when opening this repository directly.

Updates are manual: review a new upstream revision, replace the six folders together using the trusted installer, preserve licenses and project integration, and update `UPSTREAM.json`. Recheck skill metadata, paths, and contrast boundary cases. Do not use a blanket updater that changes other project or global installations. This setup does not automatically fix existing UI or establish backend correctness.
