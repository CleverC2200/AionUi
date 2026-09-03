---
name: aionui-frontend
description: Implement or review AionUi Renderer pages, components, themes, responsive layouts, and Assistant Surfaces using the repository's Arco-based frontend conventions. Use for UI work under packages/desktop/src/renderer; do not use for Main-process, AionCore, or backend-only changes.
---

# AionUi frontend

Produce UI changes that fit the existing product instead of generating a
parallel design system.

## Workflow

1. Read the root `AGENTS.md` and inspect the nearest existing page, component,
   test, and style before choosing a pattern.
2. For Arco API details, read `../arco-design/SKILL.md`, then only the component
   or pattern references needed for the task.
3. Reuse an existing AionUi business component first, an Arco component second,
   and custom React interaction only when neither covers the requirement.
4. Keep data access and state authority at their existing boundary. Renderer
   business HTTP or WebSocket work goes through `packages/desktop/src/common/adapter/`.
5. Verify the smallest relevant type, lint, test, and visual checks. For visible
   layout changes, inspect light and dark appearance plus the affected desktop
   and narrow widths.

## Local precedence over generic Arco guidance

The checked-out source, installed TypeScript declarations, and repository
conventions are authoritative when they differ from the generic Arco skill.

- The Renderer entry already imports `arco.css`; page modules do not import it
  again.
- Existing subpath imports for the React 19 adapter, locale modules, and
  type-only refs are valid. Match the nearest source pattern and type-check it.
- Match the existing IconPark wrapper and icon conventions before adding Arco
  icons or another icon package.
- Style through existing UnoCSS utilities, CSS modules, and semantic variables.
  Keep Arco scales under the existing theme mechanism; do not attach a separate
  Design Lab theme package to one page or Assistant Surface.
- User-visible text belongs in the existing i18n resources, including empty,
  loading, error, confirmation, and accessibility text.

## Assistant Surfaces

An Assistant Surface may replace the page structure and interaction model, but
it remains inside the AionUi host. Read `CONTEXT.md` and any current Surface
contract or ADR before changing this boundary. Preserve the host's global
assistant identity, conversation, permission, notification, and navigation
authority; the Surface owns only its business workspace and local presentation
state.

## Completion criteria

- The result uses the nearest established component and interaction patterns.
- Light, dark, loading, empty, error, disabled, and narrow states affected by
  the change remain usable.
- Focus, keyboard operation, popup containers, and destructive confirmations
  remain correct where relevant.
- No new runtime dependency or global UI authority is introduced without the
  task explicitly requiring it.
