# Hosting Manager

Keep changes within the user's requested scope. Check the current implementation before claiming behavior is implemented, tested, or deployed. Preserve unrelated local changes.

<!-- antislop:start -->
## Anti-slop project integration

These project integration rules take precedence over conflicting defaults in the vendored anti-slop files. Explicit user instructions remain authoritative.

### Activation and mode

- Apply anti-slop to UI, product copy, accessibility, responsive layout, and code-comment work. Do not load UI rules for backend-only implementation; `antislop-code` concerns comments, not backend correctness or architecture.
- Default to **during** for this project: apply relevant rules while working. An explicit user choice of `after` or `during` overrides this default. Do not ask the mode question on every task or write global anti-slop preferences.
- On first use in a task, briefly state the actual mode and source, e.g. `anti-slop 적용: during (프로젝트 기본값)`. Do not claim a global preference was loaded.
- Installation is complete. Skip the first-run installer/wizard. Read `DESIGN.md` for the user's existing direction before UI work; ask only when a material design decision is genuinely missing.

### Installed skills

Read `.agents/skills/antislop/SKILL.md` as the core, then only the skills relevant to the task:

| Work | Skill |
| --- | --- |
| Visual UI | `.agents/skills/antislop-ui/SKILL.md` |
| Product copy | `.agents/skills/antislop-copywriting/SKILL.md` |
| Accessibility and interaction states | `.agents/skills/antislop-human/SKILL.md` |
| Mobile and responsive layout | `.agents/skills/antislop-layoutmobile/SKILL.md` |
| Code comments | `.agents/skills/antislop-code/SKILL.md` |

In upstream text, resolve `antislop.md` to the installed core above and `skills/<name>/` to `.agents/skills/<name>/` at this project root.

### Working rules

- Preserve approved designs, existing components, design tokens, brand assets, and explicit user requirements. Do not impose a new font, palette, dark mode, layout system, or dependency merely to satisfy an upstream aesthetic preference.
- Use the filter to remove unnecessary decoration, generic copy, duplicated UI, and unhelpful comments within the requested change. Do not redesign unrelated screens.
- Existing user authorization remains valid, including approved assets and requested fixes. Do not repeat approval prompts from upstream when the session already authorizes the action. Respect read-only requests.
- Verify relevant interaction, loading, empty, error, keyboard, and responsive states. Report only checks actually performed and distinguish local verification from production deployment. Keep the user-facing result concise rather than forcing unrelated audit sections.
- Do not automatically install upstream CLIs, hooks, MCP servers, or updates. Preserve the pinned upstream files and consult `docs/anti-slop-setup.md` before updating.

### Accessibility corrections for this pinned release

- WCAG AA text contrast is at least 4.5:1 for normal text and 3:1 for large text. Large text means at least **18pt (24 CSS px) regular or 14pt (about 18.67 CSS px) bold**, or equivalent CJK size; the upstream `18px+` shortcut is incorrect.
- Compare the **unrounded** contrast ratio with thresholds; round only for display. A ratio of 4.499 fails a 4.5 requirement. See [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- The reviewed `.agents/skills/antislop-human/contrast-check.py` CLI compares raw values correctly. Read its separate normal/large verdicts; its nonzero exit code can mean normal text fails while large text passes.
- Do not rely on the upstream `--selftest` alone, and do not register or use `contrast-mcp.py` for verdicts in this revision: they compare rounded ratios. Use the reviewed CLI or an independent raw-value calculation. A contrast check alone does not establish full accessibility compliance.
<!-- antislop:end -->
