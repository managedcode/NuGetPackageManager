# ADR-0007: Rendered UI regression gate

Status: accepted; implementation and CI verification pending. Date: 2026-10-08.

## Context and decision

Source/type and extension-host checks did not detect clipped version segments, deep-family chips or review file sections. REQ-016 / AC-020 adds a development-only Playwright Chromium gate rendering the shipped media assets through the existing preview server with deterministic long-content fixtures. It verifies geometry, scrolling and keyboard recovery at editor/sidebar sizes in both themes. This supplements actual VS Code host tests and does not qualify NuGet/XML edit correctness on its own.

No production runtime dependency or package host boundary changes. Browser artifacts stay ignored and outside the VSIX. CI and Release run the gate before publication; tests remain CI-only per user direction. Automatic pixel baselines are not required: assertions target visible containment and actionable flows, while screenshots/trace support diagnosis.

## Ordered plan and ownership

TASK-046 lead owns renderer corrections, stress fixture, dependency/configuration, CI, integration and approved patch release. TASK-047 delegated worker owns responsive.spec.ts only and joins after inspected diff. Existing REQ-011/015 and AC-015/019 cover theme, sidebar navigation and compact layout; this gate exercises their regression cases. Rollback: revert the renderer/test/config scope together; never bypass a failing gate to publish. Publication uses the canonical version helper after rendered manual inspection and successful CI. No local automated test run is authorized.

## Evidence

Manual renderer inspection found and fixed short filter panels, overflowing deep chips, compressed narrow review names, hidden multi-file review changes and drawer focus escape. Manual verification passed after corrections: review has 33 changes in 3 files, every row is contained, long-name chips wrap at 260 px, short filters retain the list and footer, and Shift-Tab/Escape preserve drawer focus/recovery. Final CI/release evidence is pending.
