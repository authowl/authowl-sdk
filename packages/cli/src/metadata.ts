// Named imports, not default ones, so the bundler keeps only the version string.
// A default import inlines each sibling's ENTIRE package.json into the published
// CLI - scripts, devDependencies and all - which both leaks build config into a
// shipped artifact and churns the CLI's bytes whenever an unrelated field moves.
// A `vitest` devDependency added to @authowl/react is what changed the 0.2.5
// bundle and stalled a release; with these imports it would not have.
import { version as cliVersion } from "../package.json";
import { version as reactVersion } from "../../auth-react/package.json";
import { version as nextVersion } from "../../auth-next/package.json";

export const CLI_VERSION = cliVersion;
export const CLI_USER_AGENT = `authowl-cli/${CLI_VERSION}`;
// `authowl init` installs these with --save-exact, so releasing @authowl/react or
// @authowl/next without releasing the CLI leaves scaffolds pinned to the previous
// pair. `assertScaffoldPinCoupling` in scripts/release/sdk-manifest.mjs fails the
// release plan when that happens.
export const AUTHOWL_REACT_VERSION = reactVersion;
export const AUTHOWL_NEXT_VERSION = nextVersion;
