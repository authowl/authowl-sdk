export function appendPatch(
  path: string,
  before: string,
  appended: string,
): string {
  const start = before.length === 0 ? 1 : before.split("\n").length;
  const lines = appended.replace(/\n$/, "").split("\n");
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start},0 +${start},${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

export function fullFilePatch(
  path: string,
  before: string,
  after: string,
): string {
  const oldLines =
    before.length === 0 ? [] : before.replace(/\n$/, "").split("\n");
  const newLines =
    after.length === 0 ? [] : after.replace(/\n$/, "").split("\n");
  return [
    `--- ${before.length === 0 ? "/dev/null" : `a/${path}`}`,
    `+++ ${after.length === 0 ? "/dev/null" : `b/${path}`}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
}
