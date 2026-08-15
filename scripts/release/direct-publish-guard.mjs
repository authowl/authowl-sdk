process.stderr.write(
  'Direct package publishing is disabled. Run pnpm release:prepare and ' +
    'pnpm release:publish from the authowl-sdk workspace root.\n',
);
process.exitCode = 1;
