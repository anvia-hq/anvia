# Jev npm bootstrap

On October 7, 2026, the maintainer requested a one-time npm bootstrap for `@anvia/jev` and
completed npm web login and publication MFA. The bootstrap followed the
[Azure precedent](./v1.md#first-azure-release).

`@anvia/jev@0.0.0-bootstrap.0` was published publicly under the `bootstrap` tag from a temporary
directory outside the workspace. It contains only package metadata, a README, the MIT license,
and an empty ESM entrypoint. It has no dependencies or adapter implementation. Do not use this
version in applications; the [Jev adapter](../packages/provider-jev.md) will ship through the
normal Changesets release process.

npm initially exposed its temporary `0.0.0-stage` holding version while processing the upload.
The bootstrap version subsequently became available, with registry SHA-1
`0bf51f4f0b085cc39122e9adc3c35eadbc08dd9a`, matching the reviewed tarball. Both `latest` and
`bootstrap` point to `0.0.0-bootstrap.0`; the first functional stable release will advance `latest`.

## Trusted publisher

The following configuration was created and verified through `npm trust list` and npm's package
settings:

| Setting           | Value                                  |
| ----------------- | -------------------------------------- |
| Provider          | GitHub Actions                         |
| Repository        | `anvia-hq/anvia`                       |
| Workflow filename | `release.yml`                          |
| Environment       | `npm-publish`                          |
| Permissions       | `npm publish` and `npm stage publish`  |
| Configuration ID  | `c4ff6a6d-3412-49db-8905-86a8a44c550e` |

The creation command requested `--allow-publish`; npm also granted staged publishing:

```sh
npm trust github @anvia/jev --repository anvia-hq/anvia --file release.yml --environment npm-publish --allow-publish --yes
npm trust list @anvia/jev --json
```

The configuration is **pending validation** until its first successful OIDC publish. npm's
settings require that publish before **October 9, 2026, 15:56 UTC (22:56 WIB)**. If this deadline
passes, recreate the expired configuration before the next workflow release, following
[npm's trusted-publisher guidance](https://docs.npmjs.com/trusted-publishers/).

All subsequent publication uses `.github/workflows/release.yml` and its `npm-publish` environment.
Merge the feature and generated Version Packages pull requests, verify the release plan, and
dispatch the stable workflow from `main`. No release workflow was dispatched during bootstrap.
