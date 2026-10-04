import { assert } from "chai";
import { renderMarkdown } from "../src/utils/markdown";

describe("untrusted Markdown security", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///secret",
    "chrome://browser",
    "data:text/html,evil",
    "https://user:password@example.com",
    "java\nscript:alert(1)",
  ]) {
    it(`rejects active or credential-bearing link ${url.split(":")[0]}`, () => {
      assert.notMatch(renderMarkdown(`[link](${url})`), /<a\b[^>]*href=/);
    });
  }
  it("does not trust KaTeX href or includegraphics", () => {
    assert.notMatch(
      renderMarkdown("$\\href{javascript:alert(1)}{test}$"),
      /<a\b/,
    );
    assert.notMatch(
      renderMarkdown("$\\includegraphics{https://example.test/tracker.png}$"),
      /<img\b/,
    );
  });
  it("remote images require a click and raster data images still render", () => {
    const remote = renderMarkdown("![image](https://example.test/image.png)");
    assert.notMatch(remote, /<img\b/);
    assert.include(remote, 'href="https://example.test/image.png"');
    assert.include(
      renderMarkdown("![image](data:image/png;base64,YWJj)"),
      "<img",
    );
    assert.notMatch(
      renderMarkdown("![image](data:image/svg+xml;base64,YWJj)"),
      /<img\b/,
    );
  });
  it("retains valid links with escaped query parameters and normal math", () => {
    assert.include(
      renderMarkdown("[normal](https://example.test/?a=1&b=2)"),
      'href="https://example.test/?a=1&amp;b=2"',
    );
    assert.include(renderMarkdown("$x^2$"), "katex");
  });
});
