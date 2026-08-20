# Plate box-selection QA

Validated against the production build for this change set on 2026-08-20 with local Chrome DevTools Protocol automation.

- Dragging from A1 to B2 displayed the selection box during the gesture and selected exactly A1, A2, B1, and B2 after release.
- Command/Ctrl-dragging from A2 to C3 toggled the six wells in that rectangle against the existing selection.
- A subsequent undragged click on D1 selected only D1, confirming the 6 px drag threshold preserves the existing click interaction.
- Existing Shift range selection, Command/Ctrl point selection, double-click editing, and move mode remain separate interaction paths.
