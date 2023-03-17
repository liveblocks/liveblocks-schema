import type { Action, Diagnostic } from "@codemirror/lint";
import { linter as lint } from "@codemirror/lint";
import { getDiagnostics } from "@liveblocks/schema";

export const linter = lint(
  (view) => {
    const code = view.state.sliceDoc();
    const diagnostics: Diagnostic[] = getDiagnostics(code).map((diagnostic) => {
      return {
        from: diagnostic.range[0].offset,
        to: diagnostic.range[1].offset,
        source: diagnostic.source,
        message: diagnostic.message,
        severity: diagnostic.severity,
        actions: diagnostic.suggestions
          ?.map((suggestion): Action | undefined => {
            if (suggestion.type === "replace") {
              return {
                name: "Replace",
                apply: (view, from, to) => {
                  view.dispatch({
                    changes: { from, to, insert: suggestion.name },
                  });
                },
              };
            } else if (suggestion.type === "add-object-type-def") {
              return {
                name: "Add definition",
                apply: (view, from, to) => {
                  view.dispatch({
                    changes: {
                      from,
                      insert: `\n\ntype ${suggestion.name} {\n  # Add fields here\n}\n`,
                    },
                  });
                },
              };
            } else {
              return;
            }
          })
          .filter(Boolean) as Action[],
      };
    });

    return diagnostics;
  },
  { delay: 200 }
);
