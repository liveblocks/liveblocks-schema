import type { InferredType, MergeOptions } from "./inference";
import type { ScoredNames } from "./naming";
import { isInferredObjectType, mergeInferredObjectTypes } from "./object";

export type InferredUnionType = {
  type: "Union";
  members: Set<InferredType>;
  names: ScoredNames;
};

export function unionOfInferredTypes(
  types: InferredType[],
  opts: MergeOptions = {}
): InferredUnionType {
  return normalizeUnionType(
    {
      type: "Union",
      members: new Set(types),
      names: {},
    },
    opts
  );
}

export function isInferredUnionType(
  value: InferredType
): value is InferredUnionType {
  return value.type === "Union";
}

// Normalize union by flattening nested union types and (force-) merging members
export function normalizeUnionType(
  union: InferredUnionType,
  { force = true }: MergeOptions = {}
): InferredUnionType {
  // TODO: Assign names
  return mergeInferredUnionType({ ...union, members: new Set() }, union, {
    force,
  });
}

export function mergeInferredUnionType(
  union: InferredUnionType,
  inferredType: InferredType,
  opts: MergeOptions = {}
): InferredUnionType {
  // Avoid creating a union of unions => flatten
  if (isInferredUnionType(inferredType)) {
    return Array.from(inferredType.members).reduce<InferredUnionType>(
      (merged, member) => mergeInferredUnionType(merged, member, opts),
      union
    );
  }

  const newMembers: Set<InferredType> = new Set();
  const merged = Array.from(union.members).find((member) => {
    if (isInferredUnionType(member) && isInferredUnionType(inferredType)) {
      const merged = mergeInferredUnionType(member, inferredType, {
        force: false,
      });

      if (merged) {
        newMembers.add(merged);
        return true;
      }
    }

    if (isInferredObjectType(member) && isInferredObjectType(inferredType)) {
      const merged = mergeInferredObjectTypes(member, inferredType, opts);
      if (merged) {
        newMembers.add(merged);
        return true;
      }
    }

    // TODO: List
    return false;
  });

  if (!merged) {
    newMembers.add(inferredType);
  }

  return union;
}
