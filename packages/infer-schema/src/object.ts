import { AST } from "@liveblocks/schema";

import type { InferredFields } from "./fields";
import {
  inferLsonFields,
  inferredFieldsToAst,
  mergeInferredFields,
} from "./fields";
import type { InferContext, InferredType, MergeOptions } from "./inference";
import type { ScoredNames } from "./naming";
import { generateNames, mergeScoredNames } from "./naming";
import type { JsonObject, PlainLsonObject } from "./plainLson";
import type { InferredSchema } from "./schema";
import type { InferredUnionType } from "./union";
import { unionOfInferredTypes } from "./union";
import { invariant } from "./utils/invariant";
import { isNotUndefined } from "./utils/typeGuards";
import type { PartialBy } from "./utils/types";

export type InferredObjectType = {
  type: "Object";
  live: boolean;
  fields: InferredFields;
  names: ScoredNames;
  atomic: boolean;
};

export function inferObjectType(
  value: JsonObject | PlainLsonObject,
  ctx: InferContext
): InferredObjectType {
  const inferred: PartialBy<InferredObjectType, "fields"> = {
    names: generateNames(ctx),
    type: "Object",
    live: value.liveblocksType === "LiveObject",
    atomic: false,
  };

  const data = value.liveblocksType === "LiveObject" ? value.data : value;
  inferred.fields = inferLsonFields(data, {
    ...ctx,
    parent: inferred,
  });

  return inferred as InferredObjectType;
}

export function mergeInferredObjectTypes(
  a: InferredObjectType,
  b: InferredObjectType,
  opts: MergeOptions = {}
): InferredObjectType | InferredUnionType | undefined {
  // Cannot merge live and non-live objects
  if (a.live !== b.live) {
    return opts.force ? unionOfInferredTypes([a, b], opts) : undefined;
  }

  // Never merge atomic objects
  if (a.atomic || b.atomic) {
    return opts.force ? unionOfInferredTypes([a, b], opts) : undefined;
  }

  const mergedFields = mergeInferredFields(a.fields, b.fields, opts);
  if (!mergedFields) {
    return undefined;
  }

  return {
    live: a.live,
    names: mergeScoredNames(a.names, b.names),
    type: "Object",
    fields: mergedFields,
    atomic: false,
  };
}

export function inferredObjectTypeToAst(
  inferred: InferredObjectType,
  schema: InferredSchema
): AST.ObjectTypeDefinition {
  const name = schema.rootNames.getKey(inferred);
  invariant(isNotUndefined(name), "Object type without assigned name");

  return AST.objectTypeDefinition(
    AST.typeName(name),
    inferredFieldsToAst(inferred.fields, schema),
    !inferred.live
  );
}

export function isInferredObjectType(
  value: InferredType
): value is InferredObjectType {
  return value.type === "Object";
}
