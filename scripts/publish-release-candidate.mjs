import { run } from "./release-train.mjs";

const root = process.cwd();
const releaseTag = process.env.RELEASE_TAG;
if (releaseTag === undefined || releaseTag.length === 0) {
  throw new Error("RELEASE_TAG must be set to the v1.0.0-rc.N tag being published.");
}

run(process.execPath, ["scripts/validate-release-train.mjs", "--tag", releaseTag], root);
run("pnpm", ["--filter", "@anvia/core", "build"], root);
run("pnpm", ["--filter", "./packages/*", "--filter", "!@anvia/core", "build"], root);
run(process.execPath, ["scripts/publish-packages.mjs", "--tag", "rc"], root);
