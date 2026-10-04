import { assert } from "chai";
import { readGeminiBundleCredentials } from "../src/utils/geminiCredentials";

describe("installed Gemini bundle credentials", () => {
  const previous = (globalThis as any).IOUtils;
  afterEach(() => {
    (globalThis as any).IOUtils = previous;
  });

  it("reads synthetic application credentials across chunk boundaries", async () => {
    const id = "123-test.apps.googleusercontent.com";
    const secret = "GOCSPX-" + "synthetic_test_value";
    const text =
      '"' +
      id +
      '";' +
      " ".repeat(65536 - id.length - 4 - 10) +
      '"' +
      secret +
      '";';
    const bytes = new TextEncoder().encode(text);
    let largestRead = 0;
    (globalThis as any).IOUtils = {
      stat: async () => ({ type: "regular", size: bytes.length }),
      read: async (
        _: string,
        options: { offset: number; maxBytes: number },
      ) => {
        largestRead = Math.max(largestRead, options.maxBytes);
        return bytes.slice(options.offset, options.offset + options.maxBytes);
      },
    };
    assert.deepEqual(await readGeminiBundleCredentials("installed-bundle"), {
      clientId: id,
      clientSecret: secret,
    });
    assert.isAtMost(largestRead, 65536);
  });

  it("rejects oversized bundles without reading them", async () => {
    (globalThis as any).IOUtils = {
      stat: async () => ({ type: "regular", size: 256 * 1024 * 1024 + 1 }),
      read: async () => {
        throw new Error("must not read");
      },
    };
    assert.isNull(await readGeminiBundleCredentials("oversized"));
  });
});
