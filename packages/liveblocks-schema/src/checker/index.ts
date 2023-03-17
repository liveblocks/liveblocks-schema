import type {
  ArrayExpr,
  Definition,
  Document,
  FieldDef,
  Identifier,
  ObjectLiteralExpr,
  ObjectTypeDefinition,
  Range,
  TypeExpr,
  TypeName,
  TypeRef,
} from "../ast";
import { isBuiltInScalar, visit } from "../ast";
import { assertNever } from "../lib/assert";
import { didyoumean as dym } from "../lib/didyoumean";
import type { ErrorReporter, Suggestion } from "../lib/error-reporting";

function quote(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

const TYPENAME_REGEX = /^[A-Z_]/;

// TODO Ideally _derive_ this list of builtins directly from the grammar
// instead somehow?
const BUILTINS = ["String", "Int", "Float", "Boolean"] as const;

function suggest_general(value: string, alternatives: string[]): string[] {
  // Never suggest "Storage"
  alternatives = alternatives.filter((key) => key !== "Storage");

  const suggestions = dym(value, alternatives);

  // Special hack:
  // It can be expected that people will try to put "number" in as a type,
  // because that's TypeScript's syntax. If there is no custom type name found
  // that closely matches this typo, then try to suggest one more thing to
  // nudge them. (But only if Float and Int are already legal suggestions.)
  if (
    suggestions.length === 0 &&
    alternatives.includes("Float") &&
    alternatives.includes("Int")
  ) {
    if (/^num(ber)?$/i.test(value)) {
      return ["Float", "Int"];
    }
  }

  return suggestions;
}

function didyoumeanify(message: string, alternatives: string[]): string {
  if (alternatives.length === 0) {
    return message;
  }
  if (message.endsWith(".")) {
    message = message.slice(0, -1);
  }
  return `${message}. Did you mean ${alternatives.map(quote).join(" or ")}?`;
}

/**
 * Reserve these names for future use.
 */
const RESERVED_TYPENAMES_REGEX = /^Live|^(Presence|Array)$/i;

/**
 * Reserve these identifiers for future use.
 */
const RESERVED_IDENTIFIERS_REGEX = /^(liveblocksType)$/;

/**
 * Helper constructs for use during "checking" phase.
 */
class Context {
  errorReporter: ErrorReporter;

  // A registry of user-defined types by their identifier names. Defined during
  // the first checkDocument pass.
  registeredTypes: Map<string, Definition>;

  // Maintain a list of unreferenced definitions. If at the end of the checking
  // phase, this thing still contains any entries, we throw an error.
  unreferencedDefs: Set<Definition>;

  readonly suggestors = {
    objectTypeName: (name: string): string[] =>
      suggest_general(
        name,
        Array.from(this.registeredTypes)
          .filter(([, def]) => def._kind === "ObjectTypeDefinition")
          .map(([key]) => key)
      ),

    typeNameOrBuiltIn: (name: string): string[] =>
      suggest_general(name, [
        ...Array.from(this.registeredTypes.keys()),
        ...BUILTINS,
      ]),
  };

  constructor(errorReporter: ErrorReporter) {
    this.errorReporter = errorReporter;
    this.registeredTypes = new Map();
    this.unreferencedDefs = new Set();
  }

  //
  // Convenience helpers
  //

  lineno(range?: Range): string {
    if (range === undefined) {
      return "???";
    }

    const startLine = this.errorReporter.toPosition(range[0]).line1;
    const endLine = this.errorReporter.toPosition(range[1]).line1;
    if (startLine === endLine) {
      return `${startLine}`;
    } else {
      return `${startLine}–${endLine}`;
    }
  }

  getDefinition(typeRef: TypeRef): Definition {
    const def = this.registeredTypes.get(typeRef.ref.name);
    if (def === undefined) {
      this.report(
        `Unknown type name ${quote(typeRef.ref.name)}`,
        typeRef.ref.range
      );
      throw new Error(`Unknown type name "${typeRef.ref.name}"`);
    }
    return def;
  }

  report(title: string, range?: Range, suggestions?: Suggestion[]): void {
    // FIXME(nvie) Don't throw on the first error! Collect a few (max 3?) and then throw as one error.
    // this.errorReporter.printSemanticError(title, description, range);
    this.errorReporter.throwSemanticError(title, range, suggestions);
  }
}

function formatReplaceSuggestions(
  suggestions: string[]
): Suggestion[] | undefined {
  if (suggestions.length === 0) {
    return;
  }

  return suggestions.map((suggestion) => ({
    type: "replace",
    name: suggestion,
  }));
}

function dupes<T>(items: Iterable<T>, keyFn: (item: T) => string): [T, T][] {
  const seen = new Map<string, T>();

  const dupes: [T, T][] = [];
  for (const item of items) {
    const key = keyFn(item);
    const existing = seen.get(key);
    if (existing !== undefined) {
      dupes.push([existing, item]);
    } else {
      seen.set(key, item);
    }
  }

  return dupes;
}

function checkNoDuplicateFields(fieldDefs: FieldDef[], context: Context): void {
  // Check for any duplicate field names
  for (const [first, second] of dupes(fieldDefs, (f) => f.name.name)) {
    context.report(
      `A field named ${quote(
        first.name.name
      )} is defined multiple times (on line ${context.lineno(
        first.name.range
      )} and ${context.lineno(second.name.range)})`,
      second.name.range
    );
  }
}

function ensureNoLiveType(expr: TypeExpr, where: string, context: Context) {
  if (expr._kind === "TypeRef" && expr.asLiveObject) {
    context.report(`Cannot use LiveObject ${where}`, expr.range);
  } else if (expr._kind === "LiveListExpr") {
    context.report(`Cannot use LiveList ${where}`, expr.range);
  }
}

function checkObjectLiteralExpr(
  obj: ObjectLiteralExpr,
  context: Context
): void {
  checkNoDuplicateFields(obj.fields, context);

  // Check that none of the fields here use a "live" reference
  for (const field of obj.fields) {
    ensureNoLiveType(field.type, "inside an object literal", context);
  }
}

function checkArrayExpr(arr: ArrayExpr, context: Context): void {
  ensureNoLiveType(arr.of, "inside an array", context);
}

function checkTypeName(node: TypeName, context: Context): void {
  if (!TYPENAME_REGEX.test(node.name)) {
    context.report(
      "Type names should start with an uppercase character",
      node.range
    );
  }

  // Continue collecting more errors

  if (BUILTINS.some((bname) => bname === node.name)) {
    context.report(
      `Name ${quote(node.name)} is a built-in and cannot be redefined`,
      node.range
    );
  } else if (RESERVED_TYPENAMES_REGEX.test(node.name)) {
    context.report(
      `Name ${quote(node.name)} is reserved for future use`,
      node.range
    );
  }
}

function checkIdentifier(node: Identifier, context: Context): void {
  if (RESERVED_IDENTIFIERS_REGEX.test(node.name)) {
    context.report(`Identifier ${quote(node.name)} is reserved`, node.range);
  }
}

function checkTypeNameExists(
  node: TypeName,
  context: Context,
  suggestor: (name: string) => string[]
): void {
  if (context.registeredTypes.has(node.name)) {
    return;
  }
  const suggestions = suggestor(node.name);
  context.report(
    didyoumeanify(`Unknown type ${quote(node.name)}`, suggestor(node.name)),
    node.range,
    formatReplaceSuggestions(suggestions)
  );
}

function checkTypeRefTarget(node: TypeRef, context: Context): void {
  if (node.asLiveObject) {
    checkTypeNameIsObjectType(node.ref, context);
    checkTypeNameExists(node.ref, context, context.suggestors.objectTypeName);
  } else {
    checkTypeNameExists(
      node.ref,
      context,
      context.suggestors.typeNameOrBuiltIn
    );
  }
}

function checkTypeNameIsObjectType(node: TypeName, context: Context): void {
  const def = context.registeredTypes.get(node.name);
  if (!def) {
    const suggestions = context.suggestors.objectTypeName(node.name);
    context.report(
      didyoumeanify(`Unknown object type ${quote(node.name)}`, suggestions),
      node.range,
      formatReplaceSuggestions(suggestions)
    );
    return;
  }

  // Check that the payload of a LiveObject type is an object type
  if (def._kind !== "ObjectTypeDefinition") {
    const suggestions = context.suggestors.objectTypeName(node.name);
    context.report(
      didyoumeanify(
        `Type ${quote(node.name)} is not an object type`,
        suggestions
      ),
      node.range,
      formatReplaceSuggestions(suggestions)
    );
    return undefined;
  }
}

function checkTypeRef(ref: TypeRef, context: Context): void {
  checkTypeRefTarget(ref, context);

  //
  // For each definition, first ensure that it and annotate whether or not they
  // are usable in "live contexts" only. For example, in a definition like:
  //
  //   type Foo {
  //     a: LiveObject<Bar>  // or LiveList, or ...
  //   }
  //
  // It should be impossible to refer to Foo as a "normal" type, without
  // wrapping it in a Live<...> wrapper itself.
  //
  checkLiveObjectRefs(ref, context);
}

function checkNoForbiddenRefs(
  node: ObjectTypeDefinition | TypeExpr,
  context: Context,
  forbidden: Set<string>
): void {
  if (isBuiltInScalar(node)) {
    return;
  }

  switch (node._kind) {
    case "ObjectTypeDefinition":
      for (const field of node.fields) {
        // TODO for later. Allow _some_ self-references. For example, if
        // `field.optional`, then it'd be perfectly fine to use
        // self-references. But for reasons unrelated to the technical parsing,
        // we're currently not allowing them. See
        // https://github.com/liveblocks/liveblocks.io/issues/910 for context.
        checkNoForbiddenRefs(field.type, context, forbidden);
      }
      break;

    case "ObjectLiteralExpr":
      for (const field of node.fields) {
        // TODO for later. Allow _some_ self-references. For example, if
        // `field.optional`, then it'd be perfectly fine to use
        // self-references. But for reasons unrelated to the technical parsing,
        // we're currently not allowing them. See
        // https://github.com/liveblocks/liveblocks.io/issues/910 for context.
        checkNoForbiddenRefs(field.type, context, forbidden);
      }
      break;

    case "ArrayExpr":
    case "LiveListExpr":
      checkNoForbiddenRefs(node.of, context, forbidden);
      break;

    case "TypeRef": {
      if (forbidden.has(node.ref.name)) {
        context.report(
          `Circular reference ${quote(node.ref.name)} not yet supported`,
          node.range
        );
      }

      const def = context.registeredTypes.get(node.ref.name);
      if (def !== undefined) {
        const s = new Set(forbidden);
        s.add(node.ref.name);
        checkNoForbiddenRefs(def, context, s);
      }
      break;
    }

    default:
      return assertNever(node, "Unhandled case");
  }
}

function checkLiveObjectRefs(typeRef: TypeRef, context: Context): void {
  const def = context.getDefinition(typeRef);
  if (def._kind !== "ObjectTypeDefinition") {
    // This check only checks object type definitions
    return;
  }

  // Static objects may not be referenced with LiveObject<> references
  if (def.isStatic && typeRef.asLiveObject) {
    context.report(
      `Type ${quote(def.name.name)} cannot be used with LiveObject<${quote(
        def.name.name
      )}>`,
      typeRef.range
    );
  }

  // Live objects must be referenced with LiveObject<> references
  if (!def.isStatic && !typeRef.asLiveObject) {
    context.report(
      `Type ${quote(def.name.name)} must be referred to as ${quote(
        `LiveObject<${def.name.name}>`
      )}`,
      typeRef.range
    );
  }
}

function checkObjectTypeDefinition(
  def: ObjectTypeDefinition,
  context: Context
): void {
  checkNoDuplicateFields(def.fields, context);

  // Checks to make sure there are no self-references in object definitions
  checkNoForbiddenRefs(def, context, new Set([def.name.name]));
}

/**
 * This initial pass registers all type definitions found in the AST in the
 * registeredTypes registry in the context, for easy lookup.
 */
function registerTypeDefinitions(doc: Document, context: Context): void {
  // Now, first add all definitions to the global registry
  for (const def of doc.definitions) {
    const name = def.name.name;
    const existing = context.registeredTypes.get(name);
    if (existing !== undefined) {
      context.report(
        `A type named ${quote(
          name
        )} is defined multiple times (on line ${context.lineno(
          existing.name.range
        )} and ${context.lineno(def.name.range)})`,
        def.name.range
      );
    } else {
      // All good, let's register it!
      context.registeredTypes.set(name, def);
      context.unreferencedDefs.add(def);
    }
  }
}

/**
 * For all object type definitions, decide whether or not they are used in
 * static or live contexts.
 *
 * What will make an object type a "live" object type?
 *
 * 1. It uses a LiveObject, LiveList, or LiveMap construct in its definition
 * 2. All references to it use LiveObject<> wrappers
 *
 */
function decideStaticOrLive(doc: Document, context: Context): void {
  const staticObjRefs = new Map<string, TypeRef>();
  const liveObjRefs = new Map<string, TypeRef | null>();

  // First, if a definition uses a Live construct somewhere in its definition,
  // it must be a live type itself
  for (const def of context.registeredTypes.values()) {
    if (def._kind !== "ObjectTypeDefinition") {
      continue;
    }

    try {
      visit(
        def,
        {
          LiveListExpr: () => {
            liveObjRefs.set(def.name.name, null);
            throw "break";
          },

          TypeRef: (ref) => {
            if (ref.asLiveObject) {
              liveObjRefs.set(def.name.name, null);
              throw "break";
            }
          },
        },
        null
      );
    } catch {
      // Ignore
    }
  }

  // Otherwise, it's static only if all references to it don't use LiveObject<>
  visit(
    doc,
    {
      TypeRef: (typeRef) => {
        const def = context.registeredTypes.get(typeRef.ref.name);
        if (def !== undefined) {
          context.unreferencedDefs.delete(def);
        }

        if (def?._kind !== "ObjectTypeDefinition") {
          return;
        }

        if (typeRef.asLiveObject) {
          const conflict = staticObjRefs.get(def.name.name);
          if (conflict === undefined) {
            liveObjRefs.set(def.name.name, typeRef);
          } else {
            context.report(
              `Type ${quote(def.name.name)} already referenced as ${quote(`LiveObject<${def.name.name}>`)} on line ${context.lineno(typeRef.range)}. You cannot mix these references.`, // prettier-ignore
              conflict.range
            );
          }
        } else {
          const conflict = liveObjRefs.get(def.name.name);
          if (conflict === undefined) {
            staticObjRefs.set(def.name.name, typeRef);
          } else if (conflict === null) {
            context.report(
              `Type ${quote(def.name.name)} uses Live constructs, so it must be referenced as ${quote(`LiveObject<${def.name.name}>`)}`, // prettier-ignore
              typeRef.range
            );
          } else {
            context.report(
              `Type ${quote(def.name.name)} already referenced as ${quote(`LiveObject<${def.name.name}>`)} on line ${context.lineno(conflict.range)}. You cannot mix these references.`, // prettier-ignore
              typeRef.range
            );
          }
        }
      },
    },
    null
  );

  for (const staticName of staticObjRefs.keys()) {
    const def = context.registeredTypes.get(staticName)!;
    def.isStatic = true;
  }

  for (const liveName of liveObjRefs.keys()) {
    const def = context.registeredTypes.get(liveName)!;
    def.isStatic = false;
  }
}

/**
 * The resulting AST, after the checking phase. In this datastructure, you can
 * assume that all references are intact and semantically correct.
 */
export type CheckedDocument = {
  /**
   * Direct access to the raw AST
   */
  readonly ast: Document;

  /**
   * Direct access to the root "Storage" definition.
   */
  readonly root: ObjectTypeDefinition;

  /**
   * The list of all definitions.
   */
  readonly definitions: readonly Definition[];

  /**
   * Look up the Definition of a user-defined type by a Reference to it. This
   * lookup is guaranteed to exist in the semantic check phase.
   */
  getDefinition(ref: TypeRef): Definition;
};

export function check(
  doc: Document,
  errorReporter: ErrorReporter
): CheckedDocument {
  const context = new Context(errorReporter);

  // First pass: register all definitions in the registry
  registerTypeDefinitions(doc, context);

  // Second pass: decide static/live for all object type definitions, based on
  // how they're referenced
  decideStaticOrLive(doc, context);

  // Last pass: check the entire tree
  visit(
    doc,
    {
      Identifier: checkIdentifier,
      ArrayExpr: checkArrayExpr,
      ObjectLiteralExpr: checkObjectLiteralExpr,
      ObjectTypeDefinition: checkObjectTypeDefinition,
      TypeName: checkTypeName,
      TypeRef: checkTypeRef,
    },
    context
  );

  if (!context.registeredTypes.has("Storage")) {
    context.errorReporter.throwSemanticError(
      "Missing root object type definition named 'Storage'"
    );
  }

  // Throw an error for every unused definition
  for (const unusedDef of context.unreferencedDefs) {
    // The one exception that is allowed to be unused
    if (unusedDef.name.name === "Storage") {
      continue;
    }

    context.report(
      `Type ${quote(unusedDef.name.name)} is defined but never used`,
      unusedDef.name.range
    );
  }

  if (context.errorReporter.hasErrors) {
    throw new Error("There were errors");
  }

  return {
    ast: doc,
    root: context.registeredTypes.get("Storage") as ObjectTypeDefinition,
    definitions: Array.from(context.registeredTypes.values()),
    getDefinition(typeRef: TypeRef): Definition {
      const def = context.registeredTypes.get(typeRef.ref.name);
      if (def === undefined) {
        throw new Error(`Unknown type name "${typeRef.ref.name}"`);
      }
      return def;
    },
  };
}
