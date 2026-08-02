#!/usr/bin/env node
import { runORMCommand } from "./tooling/index.js";

void runORMCommand(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
