---
"@anvia/core": minor
"@anvia/studio": patch
---

Add Pipeline `.decide()` stages for typed decision questions and `.route()` stages that run only the branch selected by a choice decision. Graph branch nodes now carry `branchOf` (`"parallel"` or `"route"`). Studio logs decision stages, route stages, and route branches under a `decision` category.
