import { getDiagnostics } from "..";

describe("diagnostic error reporting", () => {
  it("getDiagnostics returns empty list on valid schema", () => {
    expect(getDiagnostics("type Storage {}")).toEqual([]);
    expect(getDiagnostics("type Storage { foo?: String }")).toEqual([]);
  });

  it("getDiagnostics returns list of issues on schema with parse errors", () => {
    expect(getDiagnostics("type Storage {")).toEqual([
      {
        source: "parser",
        severity: "error",
        message: 'Expected "}" or <identifier> but end of input found.',
        range: [
          { column1: 15, line1: 1, offset: 14 },
          { column1: 15, line1: 1, offset: 14 },
        ],
      },
    ]);
  });

  it("getDiagnostics returns list of issues on schema with semantic errors", () => {
    expect(getDiagnostics("type Storage { x: NonExisting }")).toEqual([
      {
        source: "checker",
        severity: "error",
        message: "Unknown type 'NonExisting'",
        range: [
          { column1: 19, line1: 1, offset: 18 },
          { column1: 30, line1: 1, offset: 29 },
        ],
      },
    ]);
  });

  it("getDiagnostics returns list of issues on schema with semantic errors without range", () => {
    expect(getDiagnostics("type Henk {}")).toEqual([
      {
        source: "checker",
        severity: "error",
        message: "Missing root object type definition named 'Storage'",
        range: undefined,
      },
    ]);
  });
});
