import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileTransaction, undoLastChange } from "../src/mutation/transaction";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("file transaction", () => {
  it("persists a private undo set and restores bytes and modes exactly", async () => {
    const root = await temporaryRoot();
    const original = Buffer.from("original\n", "utf8");
    await writeFile(join(root, "existing.txt"), original, { mode: 0o640 });
    const transaction = new FileTransaction(root);

    await transaction.write({
      relativePath: "existing.txt",
      content: "changed\n",
    });
    await transaction.write({
      relativePath: "nested/new.txt",
      content: "new\n",
    });
    await transaction.persistUndo("pnpm", new Date("2026-07-14T10:00:00.000Z"));

    expect((await stat(join(root, ".authowl/undo"))).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(root, ".authowl/undo/manifest.json"))).mode & 0o777,
    ).toBe(0o600);
    await undoLastChange(root);

    expect(await readFile(join(root, "existing.txt"))).toEqual(original);
    expect((await stat(join(root, "existing.txt"))).mode & 0o777).toBe(0o640);
    await expect(readFile(join(root, "nested/new.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stores sensitive appends without copying either environment secret", async () => {
    const root = await temporaryRoot();
    const before = "DATABASE_URL=secret-before\n";
    const key = "pk_live_00000000-0000-4000-8000-000000000000_newsecret";
    const after = `${before}\nAUTHOWL_PUBLISHABLE_KEY=${key}\n`;
    await writeFile(join(root, ".env.local"), before, { mode: 0o600 });
    const transaction = new FileTransaction(root);
    const change = {
      relativePath: ".env.local",
      content: after,
      sensitiveAppend: true,
      mode: 0o600,
    } as const;
    await transaction.write(change);
    const patch = transaction.patchFor([change]);
    expect(patch).not.toContain("secret-before");
    await transaction.persistUndo("npm");

    const manifest = await readFile(
      join(root, ".authowl/undo/manifest.json"),
      "utf8",
    );
    expect(manifest).not.toContain("secret-before");
    expect(manifest).not.toContain(key);
    await undoLastChange(root);
    expect(await readFile(join(root, ".env.local"), "utf8")).toBe(before);
  });

  it("refuses undo atomically after any generated file changes", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "one.txt"), "one\n");
    await writeFile(join(root, "two.txt"), "two\n");
    const transaction = new FileTransaction(root);
    await transaction.write({
      relativePath: "one.txt",
      content: "generated one\n",
    });
    await transaction.write({
      relativePath: "two.txt",
      content: "generated two\n",
    });
    await transaction.persistUndo("yarn");
    await writeFile(join(root, "two.txt"), "user edit\n");

    await expect(undoLastChange(root)).rejects.toThrow("two.txt changed");
    expect(await readFile(join(root, "one.txt"), "utf8")).toBe(
      "generated one\n",
    );
    expect(await readFile(join(root, "two.txt"), "utf8")).toBe("user edit\n");
  });

  it("rolls back created files and refuses traversal and symlink targets", async () => {
    const root = await temporaryRoot();
    const transaction = new FileTransaction(root);
    await transaction.write({
      relativePath: "created/path.txt",
      content: "value\n",
    });
    await transaction.rollback();
    await expect(
      readFile(join(root, "created/path.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(transaction.capture("../escape.txt")).rejects.toThrow(
      "Unsafe generated path",
    );
    await writeFile(join(root, "target.txt"), "target\n");
    await symlink(join(root, "target.txt"), join(root, "link.txt"));
    await expect(transaction.capture("link.txt")).rejects.toThrow(
      "non-regular file",
    );
    await mkdir(join(root, "target-directory"));
    await symlink(
      join(root, "target-directory"),
      join(root, "linked-directory"),
    );
    await expect(
      transaction.write({
        relativePath: "linked-directory/escape.txt",
        content: "unsafe\n",
      }),
    ).rejects.toThrow("unsafe generated path parent");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "authowl-transaction-"));
  roots.push(root);
  return root;
}
