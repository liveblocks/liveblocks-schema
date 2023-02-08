import didyoumean from "didyoumean";

import type {
  Definition,
  Document,
  Identifier,
  LiveObjectTypeExpr,
  ObjectLiteralExpr,
  ObjectTypeDef,
  Range,
  TypeExpr,
  TypeRef,
} from "../ast";
import { visit } from "../ast";
import { assertNever } from "../lib/assert";
import type { ErrorReporter } from "../lib/error-reporting";

function quote(value: string): string {
  return JSON.stringify(value);
}

// XXX Can we _derive_ the builtins in this list from the grammar instead?
const BUILTIN_KEYWORDS = /^(String|Int|Float|Boolean)$/i;
const RESERVED_NAMES = /^(Presence$|Live)/i;

class Context {
  errorReporter: ErrorReporter;

  // A registry of user-defined types by their identifier names
  registeredTypes: Map<string, Definition>;

  constructor(errorReporter: ErrorReporter) {
    this.errorReporter = errorReporter;
    this.registeredTypes = new Map();
  }

  //
  // Convenience helpers
  //

  lineno(range?: Range): string {
    if (range === undefined) {
      return "???";
    }

    const startLine = this.errorReporter.lineInfo(range[0]).line1;
    const endLine = this.errorReporter.lineInfo(range[1]).line1;
    if (startLine === endLine) {
      return `${startLine}`;
    } else {
      return `${startLine}–${endLine}`;
    }
  }

  report(title: string, description: (string | null)[], range?: Range): void {
    // FIXME(nvie) Don't throw on the first error! Collect a few (max 3?) and then throw as one error.
    // this.errorReporter.printSemanticError(title, description, range);
    this.errorReporter.throwSemanticError(title, description, range);
  }
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

function checkObjectLiteralExpr(
  obj: ObjectLiteralExpr,
  context: Context
): void {
  for (const [first, second] of dupes(obj.fields, (f) => f.name.name)) {
    context.report(
      `A field named ${quote(
        first.name.name
      )} is defined multiple times (on line ${context.lineno(
        first.name.range
      )} and ${context.lineno(second.name.range)})`,
      [],
      second.name.range
    );
  }
}

function checkLiveObjectTypeExpr(
  node: LiveObjectTypeExpr,
  context: Context
): void {
  // Check that the payload of a LiveObject type is an object type
  if (
    context.registeredTypes.get(node.of.name.name)?._kind !== "ObjectTypeDef"
  ) {
    context.report(
      "Not an object type",
      ["LiveObject expressions can only wrap object types"],
      node.of.range
    );
    return undefined;
  }
}

// XXX This check really belongs to TypeName nodes, not Identifiers
function checkIdentifier(node: Identifier, context: Context): void {
  if (BUILTIN_KEYWORDS.test(node.name)) {
    context.report(
      `Type name ${quote(node.name)} is a built-in type`,
      [],
      node.range
    );
  } else if (RESERVED_NAMES.test(node.name)) {
    context.report(
      `Type name ${quote(node.name)} is reserved for future use`,
      [],
      node.range
    );
  }
}

function checkTypeRef(node: TypeRef, context: Context): void {
  const typeDef = context.registeredTypes.get(node.name.name);
  if (typeDef === undefined) {
    const suggestion = didyoumean(
      node.name.name,
      Array.from(context.registeredTypes.keys())
    ) as string;

    context.report(
      `Unknown type ${quote(node.name.name)}`,
      [
        `I didn't understand what ${quote(node.name.name)} refers to.`,
        suggestion ? `Did you mean ${quote(suggestion)}?` : null,
      ],
      node.range
    );
  }
}

// FIXME(nvie) Check that type definitions don't use reserved types names e.g. `type String { ... }`)
// FIXME(nvie) Other examples: Boolean, LiveXxx, Regex, List, Email

// FIXME(nvie) Check that lowercased type names are disallowed (e.g. `type henk { ... }`)
//                                                                         ^ Must start with uppercase

function checkNoForbiddenRefs(
  typeExpr: TypeExpr,
  context: Context,
  forbidden: Set<string>
): void {
  switch (typeExpr._kind) {
    case "StringKeyword":
    case "IntKeyword":
    case "FloatKeyword":
      // Fine
      break;

    case "LiveObjectTypeExpr":
      checkNoForbiddenRefs(typeExpr.of, context, forbidden);
      break;

    case "ObjectLiteralExpr":
      for (const field of typeExpr.fields) {
        if (!field.optional) {
          checkNoForbiddenRefs(field.type, context, forbidden);
        }
      }
      break;

    case "TypeRef": {
      if (forbidden.has(typeExpr.name.name)) {
        context.report(
          `Cyclical reference detected: ${quote(typeExpr.name.name)}`,
          [],
          typeExpr.range
        );
      }

      const def = context.registeredTypes.get(typeExpr.name.name);
      if (def !== undefined) {
        const s = new Set(forbidden);
        s.add(typeExpr.name.name);
        checkNoForbiddenRefs(def.obj, context, s);
      }
      break;
    }

    default:
      return assertNever(typeExpr, "Unhandled case");
  }
}

function checkObjectTypeDef(def: ObjectTypeDef, context: Context): void {
  // Checks to make sure there are no self-references in object definitions
  checkNoForbiddenRefs(def.obj, context, new Set([def.name.name]));
}

function checkDocument(doc: Document, context: Context): void {
  // Now, first add all definitions to the global registry
  for (const def of doc.definitions) {
    // FIXME(nvie) Factor out into checkDefinition?
    const name = def.name.name;
    const existing = context.registeredTypes.get(name);
    if (existing !== undefined) {
      context.report(
        `A type named ${quote(
          name
        )} is defined multiple times (on line ${context.lineno(
          existing.name.range
        )} and ${context.lineno(def.name.range)})`,
        [
          "You cannot declare types multiple times.",
          "Please remove the duplicate definition, or use a different name.",
        ],
        def.name.range
      );
    } else {
      // All good, let's register it!
      context.registeredTypes.set(name, def);
    }
  }

  if (!context.registeredTypes.has("Storage")) {
    context.errorReporter.throwSemanticError(
      'Missing root definition "Storage"',
      [
        'Every Liveblocks schema requires at least one type definition named "Storage",',
        "which indicated the root of the storage. You can declare a schema like this:",
        "",
        "  type Storage {",
        "    // Your fields here",
        "  }",
      ]
    );
  }
}

export type CheckedDocument = {
  /**
   * The raw AST node.
   */
  // FIXME(nvie) Keep or remove?
  // ast: Document;

  /**
   * A map of bindings from user-defined type names to their respective
   * definitions.
   */
  // FIXME(nvie) Keep or remove?
  // types: Map<string, Definition>;

  /**
   * Direct access to the root "Storage" definition.
   */
  root: ObjectTypeDef;

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

  // Check the entire tree
  visit(
    doc,
    {
      Document: checkDocument,
      Identifier: checkIdentifier,
      LiveObjectTypeExpr: checkLiveObjectTypeExpr,
      ObjectLiteralExpr: checkObjectLiteralExpr,
      ObjectTypeDef: checkObjectTypeDef,
      TypeRef: checkTypeRef,
    },
    context
  );

  if (context.errorReporter.hasErrors) {
    throw new Error("There were errors");
  }

  return {
    // FIXME(nvie) Keep or remove?
    // ast: doc,
    // types: context.registeredTypes,

    root: context.registeredTypes.get("Storage") as ObjectTypeDef,
    getDefinition(ref: TypeRef): Definition {
      const def = context.registeredTypes.get(ref.name.name);
      if (def === undefined) {
        throw new Error(`Unknown type name "${ref.name.name}"`);
      }
      return def;
    },
  };
}
