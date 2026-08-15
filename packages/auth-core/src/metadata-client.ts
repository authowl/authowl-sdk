import type { ActionFetchOptions, AuthActionResult } from './client';
import type { AuthHttpClient } from './http-client';
import { asRecord, decodeJsonObject } from './response-schema';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/** Browser-safe metadata for the currently signed-in user. */
export interface UserMetadata {
  /** Trusted server-authored data. End users can read but cannot write it. */
  publicMetadata: JsonObject;
  /** End-user-owned data. Applications must treat every value as untrusted. */
  unsafeMetadata: JsonObject;
  /** Pass this value as expectedVersion on the next unsafe metadata write. */
  metadataVersion: number;
}

export interface UpdateUnsafeMetadataOptions {
  expectedVersion: number;
  /** JSON Merge Patch. Null members delete the matching stored key. */
  unsafeMetadata: JsonObject;
}

export async function getUserMetadata(
  http: AuthHttpClient,
  fetchOptions?: ActionFetchOptions,
): Promise<AuthActionResult<UserMetadata>> {
  return http.request<UserMetadata>('/user/metadata', {
    fetchOptions,
    decode: decodeMetadata,
  });
}

export async function updateUnsafeMetadata(
  http: AuthHttpClient,
  input: UpdateUnsafeMetadataOptions,
  fetchOptions?: ActionFetchOptions,
): Promise<AuthActionResult<UserMetadata>> {
  return http.request<UserMetadata>('/user/metadata', {
    method: 'PATCH',
    body: {
      expected_version: input.expectedVersion,
      unsafe_metadata: input.unsafeMetadata,
    },
    fetchOptions,
    decode: decodeMetadata,
  });
}

function decodeMetadata(value: unknown): UserMetadata {
  const row = asRecord(value);
  const publicMetadata = decodeJsonObject(row.public_metadata);
  const unsafeMetadata = decodeJsonObject(row.unsafe_metadata);
  if (
    !Number.isSafeInteger(row.metadata_version) ||
    (row.metadata_version as number) < 0
  ) {
    throw new TypeError('Invalid AuthOwl metadata response');
  }
  return {
    publicMetadata,
    unsafeMetadata,
    metadataVersion: row.metadata_version as number,
  };
}
