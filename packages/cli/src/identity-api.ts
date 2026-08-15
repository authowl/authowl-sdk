import {
  invalidCliResponse,
  isRecord,
  isUuid,
  requestCliApi,
  type CliApiDependencies,
} from "./cli-api";
import type { CliCredential } from "./credentials";

export type CliIdentity = {
  user: { id: string; email: string };
  workspace: { id: string; name: string };
};

export async function getCliIdentity(
  credential: CliCredential,
  dependencies: CliApiDependencies = {},
): Promise<CliIdentity> {
  const body = await requestCliApi(credential, "/api/cli/me", {}, dependencies);
  if (!isRecord(body.user) || !isRecord(body.workspace)) {
    throw invalidCliResponse();
  }
  if (
    typeof body.user.id !== "string" ||
    !isUuid(body.user.id) ||
    typeof body.user.email !== "string" ||
    !body.user.email ||
    typeof body.workspace.id !== "string" ||
    !isUuid(body.workspace.id) ||
    typeof body.workspace.name !== "string" ||
    !body.workspace.name
  ) {
    throw invalidCliResponse();
  }
  return {
    user: { id: body.user.id, email: body.user.email },
    workspace: { id: body.workspace.id, name: body.workspace.name },
  };
}
