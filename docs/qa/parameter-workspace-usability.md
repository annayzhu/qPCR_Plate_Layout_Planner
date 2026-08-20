# Parameter workspace usability QA

Validated against the production build for this change set on 2026-08-20 with local Chrome DevTools Protocol automation.

## Interaction checks

- Loaded the built-in example and generated a 96-well layout.
- Deleted `Sample_01`; Command+Z restored all eight samples in their original order.
- Alt+ArrowDown moved `Sample_01` below `Sample_02`; Command+Z restored the order.
- Opened the drag-handle menu, used the visible Move down control, and restored the order with Command+Z.

## Responsive and scroll checks

- 1600 × 1000: setup, plate preview, and reaction calculator were independent vertical scroll regions. Scrolling setup and calculator to 180 px left the preview at 0 px.
- 1024 × 900: workspace changed to single-column flow without horizontal overflow.
- 390 × 844: workspace remained single-column and `body.scrollWidth` equaled `body.clientWidth` (390 px).

Automated unit, rendered-shell, production-build, and portable-package tests remain the durable regression checks. This browser pass is the visual acceptance record required by `specs/parameter-workspace-usability.md`.
