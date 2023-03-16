import type { Action, Diagnostic } from "@codemirror/lint";
import { linter as lint } from "@codemirror/lint";
import { getDiagnostics } from "@liveblocks/schema";

export const linter = lint(
  (view) => {
    const code = view.state.sliceDoc();
    const diagnostics: Diagnostic[] = getDiagnostics(code).map((diagnostic) => {
      return {
        from: diagnostic.range?.[0].offset ?? 0,
        to: diagnostic.range?.[1].offset ?? code.length,
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
                    changes: { from, to, insert: suggestion.value },
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
