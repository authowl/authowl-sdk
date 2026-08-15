import { readFile, writeFile } from "node:fs/promises";

const [consumerPath, ...packagePaths] = process.argv.slice(2);

if (!consumerPath || packagePaths.length === 0) {
  throw new Error(
    "usage: prepare-npm-consumer-input.mjs <consumer-package.json> <sdk-package.json>...",
  );
}

const consumer = JSON.parse(await readFile(consumerPath, "utf8"));
consumer.dependencies ??= {};
consumer.optionalDependencies ??= {};

for (const packagePath of packagePaths) {
  const sdkPackage = JSON.parse(await readFile(packagePath, "utf8"));
  mergeDependencies(consumer.dependencies, sdkPackage.dependencies, sdkPackage.name);
  mergeDependencies(
    consumer.optionalDependencies,
    sdkPackage.optionalDependencies,
    sdkPackage.name,
  );
}

if (Object.keys(consumer.optionalDependencies).length === 0) {
  delete consumer.optionalDependencies;
}

await writeFile(consumerPath, `${JSON.stringify(consumer, null, 2)}\n`);

function mergeDependencies(target, dependencies, packageName) {
  for (const [name, version] of Object.entries(dependencies ?? {})) {
    if (version.startsWith("workspace:")) continue;

    const existing = target[name];
    if (existing !== undefined && existing !== version) {
      throw new Error(
        `${packageName} requires ${name}@${version}, but the consumer cache manifest requires ${name}@${existing}`,
      );
    }
    target[name] = version;
  }
}
