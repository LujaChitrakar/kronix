import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJsVisitor } from "@codama/renderers-js";
import { renderVisitor as renderRustVisitor } from "@codama/renderers-rust";
import { readFileSync } from "fs";

const idl = JSON.parse(
  readFileSync("./src/generated/trigger_program.json", "utf-8"),
);
const codama = createFromRoot(rootNodeFromAnchor(idl));

codama.accept(renderJsVisitor("./src/generated/ts"));
codama.accept(renderRustVisitor("./src/generated/rust"));
