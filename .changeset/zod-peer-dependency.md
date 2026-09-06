---
"@anvia/core": patch
"@anvia/graph": patch
"@anvia/neo4j": patch
---

Move `zod` from `dependencies` to `peerDependencies` (`^4.4.0`). These packages expose zod types in their public API, so declaring zod as a regular dependency forced consumers to install a second, incompatible copy whenever their own zod version differed. Typechecks against such projects failed with `TS2769` (`ZodSchema`/`def.checks` incompatibility between the two copies) and type instantiation could become slow enough to crash `tsc` on large codebases. With zod as a peer dependency, consumers compile and run against a single shared copy. Local development and tests now resolve zod through `devDependencies` (`^4.5.4`); zod 4.4.x is verified to satisfy the floor.
