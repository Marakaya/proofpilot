import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

const home = process.env.PROOFPILOT_TEST_HOME;
if (!home || !path.isAbsolute(home)) throw new Error("Tests require an absolute private PROOFPILOT_TEST_HOME.");
const stat = fs.lstatSync(home);
if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === "function" &&
    (stat.uid !== process.getuid() || (stat.mode & 0o077)))) throw new Error("The test home is unsafe.");
const userInfo = os.userInfo;
os.homedir = () => process.env.HOME || home;
os.userInfo = options => ({ ...userInfo(options), homedir: home });
syncBuiltinESMExports();
