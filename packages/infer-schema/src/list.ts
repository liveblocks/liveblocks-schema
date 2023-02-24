import type { InferContext, InferredType, MergeOptions } from "./inference";
import { inferType } from "./inference";
import type { ScoredNames } from "./naming";
import { generateNames, mergeScoredNames } from "./naming";
import type { JsonArray, PlainLsonList } from "./plainLson";
import type { InferredUnionType } from "./union";
import { unionOfInferredTypes } from "./union";
import type { PartialBy } from "./utils/types";

export type InferredListType = {
  type: "List";
  members: InferredUnionType;
  names: ScoredNames;
  live: boolean;
};

export function inferListType(
  value: PlainLsonList | JsonArray,
  ctx: InferContext
): InferredListType {
  const isLive = !Array.isArray(value);
  const inferred: PartialBy<InferredListType, "members"> = {
    type: "List",
    names: generateNames(ctx),
    live: isLive,
  };

  const values = isLive ? value.data : value;

  // TODO: Adjust context
  const inferredValueTypes = values.map((value) => inferType(value, ctx));
  inferred.members = unionOfInferredTypes(inferredValueTypes, { force: true });

  return inferred as InferredListType;
}

export function isInferredListType(
  value: InferredType
): value is InferredListType {
  return value.type === "List";
}

export function mergeInferredListTypes(
  a: InferredListType,
  b: InferredListType,
  opts: MergeOptions = {}
): InferredListType | InferredUnionType | undefined {
  if (a.live !== b.live) {
    return opts.force ? unionOfInferredTypes([a, b], opts) : undefined;
  }

  return {
    ...a,
    names: mergeScoredNames(a.names, b.names),
    members: unionOfInferredTypes([a.members, b.members], { force: true }),
  };
}
