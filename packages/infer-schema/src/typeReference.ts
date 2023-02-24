import { AST } from "@liveblocks/schema";

import type { InferContext, InferredType, MergeOptions } from "./inference";
import { inferType, mergeInferredTypes } from "./inference";
import { isInferredObjectType } from "./object";
import type { PlainLson } from "./plainLson";
import { inferredScalarTypeToAst, isInferredScalarType } from "./scalar";
import type { InferredSchema } from "./schema";
import { invariant } from "./utils/invariant";
import { isNotUndefined } from "./utils/typeGuards";

export type InferredTypeReference = {
  value: InferredType;
  optional: boolean;
};

export function inferTypeReference(
  value: PlainLson,
  ctx: InferContext
): InferredTypeReference {
  return { value: inferType(value, ctx), optional: false };
}

export function mergeInferredTypeReferences(
  a: InferredTypeReference,
  b: InferredTypeReference,
  opts: MergeOptions = {}
): InferredTypeReference | undefined {
  const mergeValue = mergeInferredTypes(a.value, b.value, opts);
  if (!mergeValue) {
    return undefined;
  }

  return {
    value: mergeValue,
    optional: a.optional || b.optional,
  };
}

export function inferredTypeReferenceToAst(
  { value }: InferredTypeReference,
  schema: InferredSchema
): AST.BuiltInScalar | AST.TypeRef {
  if (isInferredScalarType(value)) {
    return inferredScalarTypeToAst(value, schema);
  }

  if (isInferredObjectType(value)) {
    const name = schema.rootNames.getKey(value);
    invariant(
      isNotUndefined(name),
      "Root type reference without assigned name"
    );

    return AST.typeRef(AST.typeName(name), value.live);
  }

  throw new Error("Not implemented");
}
