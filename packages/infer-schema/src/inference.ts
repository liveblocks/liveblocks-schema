import { assertNever } from "@liveblocks/core";

import { inferLsonFields } from "./fields";
import type { InferredListType } from "./list";
import {
  inferListType,
  isInferredListType,
  mergeInferredListTypes,
} from "./list";
import type { InferredObjectType } from "./object";
import {
  inferObjectType,
  isInferredObjectType,
  mergeInferredObjectTypes,
} from "./object";
import type { JsonScalar, PlainLson, PlainLsonObject } from "./plainLson";
import type { InferredScalarType } from "./scalar";
import {
  inferScalarType,
  isInferredScalarType,
  mergeInferredScalarTypes,
} from "./scalar";
import type { InferredUnionType } from "./union";
import { isInferredUnionType, unionOfInferredTypes } from "./union";
import type { PartialBy } from "./utils/types";

type FieldChildContext = {
  parent: PartialBy<InferredObjectType, "fields">;
  field: string;
};

export type InferContext = FieldChildContext; // TODO: Expand for union, list, ...
export type MergeOptions = { force?: boolean };
export type InferredType =
  | InferredScalarType
  | InferredObjectType
  | InferredUnionType
  | InferredListType;

export function isAtomic(type: InferredType): boolean {
  return isInferredObjectType(type) && type.atomic;
}

export function inferStorageType(value: PlainLsonObject): InferredObjectType {
  const storage: PartialBy<InferredObjectType, "fields"> = {
    names: { Storage: 1 },
    type: "Object",
    live: true,
    atomic: true,
  };

  const fields = inferLsonFields(value.data, { parent: storage });
  storage.fields = fields;

  return storage as InferredObjectType;
}

export function inferType(value: PlainLson, ctx: InferContext): InferredType {
  if (typeof value !== "object" || value === null || value === undefined) {
    return inferScalarType(value as JsonScalar, ctx);
  }

  if (Array.isArray(value)) {
    return inferListType(value, ctx);
  }

  if (!("liveblocksType" in value) || value.liveblocksType === undefined) {
    return inferObjectType(value, ctx);
  }

  if (value.liveblocksType === "LiveObject") {
    return inferObjectType(value, ctx);
  }

  if (value.liveblocksType === "LiveList") {
    return inferListType(value, ctx);
  }

  if (value.liveblocksType === "LiveMap") {
    throw new Error("Not implemented");
  }

  assertNever(value, `Unknown plain lson type: ${value}`);
}

export function mergeInferredTypes(
  a: InferredType,
  b: InferredType,
  opts: MergeOptions = {}
): InferredType | undefined {
  if (isInferredScalarType(a) && isInferredScalarType(b)) {
    return mergeInferredScalarTypes(a, b, opts);
  }

  if (isInferredObjectType(a) && isInferredObjectType(b)) {
    return mergeInferredObjectTypes(a, b, opts);
  }

  if (isInferredListType(a) && isInferredListType(b)) {
    return mergeInferredListTypes(a, b, opts);
  }

  if (isInferredUnionType(a)) {
    return mergeInferredTypes(a, b, opts);
  }

  if (opts.force) {
    return unionOfInferredTypes([a, b]);
  }

  // TODO: Add missing types
  return undefined;
}
