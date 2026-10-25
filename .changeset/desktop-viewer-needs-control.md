---
"@anvia/react-ui": patch
---

`SandboxDesktop` now ignores the viewer's keyboard and pointer until the viewer takes over. While the agent had control the viewer was still interactive, so a person's input mixed with the agent's even though the controls said "The agent has control".
