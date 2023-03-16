/* eslint-disable @typescript-eslint/no-var-requires */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const { LiveblocksSchema } = require("../../dist/index.js");
const fs = require("fs/promises");
const path = require("path");

const ERROR_CHARACTER = "⚠";

describe("LiveblocksSchema", () => {
  it("should TODO", async () => {
    const parser = LiveblocksSchema.parser;
    console.log(process.cwd());
    const schema = await fs.readFile(
      path.resolve(process.cwd(), "./src/__tests__/example.schema"),
      "utf-8"
    );

    expect(parser.parse(schema).toString()).not.toContain(ERROR_CHARACTER);
  });
});
