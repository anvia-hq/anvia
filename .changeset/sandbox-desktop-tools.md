---
"@anvia/sandbox": minor
---

Add `createDesktopTools({ sandbox })` for agents to see and drive a remote sandbox desktop:
`desktop_screenshot`, `desktop_click`, `desktop_mouse_move`, `desktop_drag`, `desktop_scroll`,
`desktop_type`, `desktop_key`, `desktop_cursor_position` and `desktop_wait`. Arguments follow
Claude's computer-use tool (`coordinate`, `start_coordinate`, `text`, `scroll_direction`,
`scroll_amount`), and coordinates are pixels of the screenshot the model was shown, which is scaled
to fit Claude's image limits and translated back to display pixels with out-of-range points refused.

`desktopToolRecovery` marks screenshots, the cursor position and waiting `safe`, and every input
`idempotent`, since the run's `operationId` reaches the daemon. Inputs fail with `desktop_locked`
while a person has taken control; looking never does.

Input tools wait `settleMs` (300 ms by default) after acting, so the application can react before
the next input arrives; without it, keystrokes sent right after a shortcut are lost by programs
that are still focusing a field.
