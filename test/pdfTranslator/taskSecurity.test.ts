import { assert } from "chai";
import { posix } from "node:path";
import { clearExpiredTaskSecrets } from "../../src/modules/pdfTranslator/taskSecurity";

describe("translation credential retention", () => {
  it("expires old secrets while retaining live jobs, outputs and symlink targets", async () => {
    const previousIO = (globalThis as any).IOUtils;
    const previousPath = (globalThis as any).PathUtils;
    const removed: string[] = [];
    const now = 3 * 86400000;
    (globalThis as any).PathUtils = posix;
    (globalThis as any).IOUtils = {
      getChildren: async () => ["/jobs/old", "/jobs/current", "/jobs/link"],
      getFile: async (path: string) => ({
        isSymlink: () => path === "/jobs/link",
      }),
      stat: async (path: string) => {
        if (path === "/jobs/link") return { type: "symlink" };
        if (/\/(old|current)$/.test(path)) return { type: "directory" };
        return {
          type: "regular",
          lastModified: path.startsWith("/jobs/old/") ? 0 : now,
        };
      },
      remove: async (path: string) => {
        removed.push(path);
      },
    };
    try {
      await clearExpiredTaskSecrets("/jobs", now);
      assert.deepEqual(removed, [
        "/jobs/old/task.json",
        "/jobs/old/config.toml",
      ]);
    } finally {
      (globalThis as any).IOUtils = previousIO;
      (globalThis as any).PathUtils = previousPath;
    }
  });
});
