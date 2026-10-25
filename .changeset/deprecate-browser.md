---
"@anvia/browser": patch
---

Deprecate `@anvia/browser`. The package and its Docker image will be removed in the next release
cycle. For a visible desktop with Chromium that an agent can see and drive and a person can take
over, use the `@anvia/sandbox` desktop image with `createDesktopTools`. The semantic `browser_*`
tools have no direct replacement; agents drive the desktop with screenshot, click, and type tools
instead. This final release only adds deprecation notices to the README, MIGRATION notes, and
package metadata.
