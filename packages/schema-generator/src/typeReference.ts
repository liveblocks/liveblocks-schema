import { AST } from "@liveblocks/schema";
import { combineInferredTypes, InferredType, inferType } from ".";
import { inferredScalarTypeToAst, isInferredScalarType } from "./scalar";
import { InferredSchema } from "./schema";
import { ChildContext, PlainLson } from "./types";
import { invariant } from "./utils/invariant";

export type InferredTypeReference = {
  value: InferredType;
  optional: boolean;
};

export function inferTypeReference(
  value: PlainLson,
  ctx: ChildContext
): InferredTypeReference {
  return { value: inferType(value, ctx), optional: false };
}

export function combineTypeReferences(
  a: InferredTypeReference,
  b: InferredTypeReference
): InferredTypeReference | undefined {
  const combinedValue = combineInferredTypes(a.value, b.value);
  if (!combinedValue) {
    return undefined;
  }

  return {
    value: combinedValue,
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

  if (value.type === "LiveObject" || value.type === "Object") {
    const name = schema.rootNames.getKey(value);
    invariant(name != null, "Root type reference without assigned name");

    return {
      _kind: "TypeRef",
      asLiveObject: value.type === "LiveObject",
      ref: {
        _kind: "TypeName",
        name,
        range: [0, 0],
      },
      range: [0, 0],
    };
  }

  throw new Error("Not implemented");
}
