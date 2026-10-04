import { assert } from "chai";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import {
  buildGeminiCallbackServerScript,
  oauthStateMatches,
} from "../src/utils/geminiCallback";

describe("Gemini callback security", () => {
  it("invalid callbacks do not finish login, and error responses are inert", () => {
    const state = "f".repeat(64);
    let handler: any;
    let closed = false;
    const writes: any[] = [];
    const server = {
      listen() {},
      close() {
        closed = true;
      },
    };
    runInNewContext(
      buildGeminiCallbackServerScript("/fake/result.json", state),
      {
        URL,
        Buffer,
        setTimeout() {},
        process: { exit() {} },
        require(name: string) {
          if (name === "crypto") return crypto;
          if (name === "http")
            return {
              createServer(fn: any) {
                handler = fn;
                return server;
              },
            };
          if (name === "fs")
            return {
              writeFileSync(...args: any[]) {
                writes.push(args);
              },
            };
          throw Error(name);
        },
      },
    );
    function request(
      value: string,
      headers: any = { host: "localhost:8085" },
      method = "GET",
    ) {
      const response: any = {
        status: 0,
        headers: {},
        setHeader(k: string, v: string) {
          this.headers[k] = v;
        },
        writeHead(code: number) {
          this.status = code;
        },
        end(body: string) {
          this.body = body;
        },
      };
      handler({ url: value, headers, method }, response);
      return response;
    }
    for (const bad of [
      "",
      "a".repeat(64),
      "中".repeat(64),
      `${state}&state=${state}`,
    ]) {
      assert.equal(
        request(`/oauth2callback?code=fake&state=${bad}`).status,
        403,
      );
    }
    assert.equal(
      request(`/oauth2callback?code=fake&state=${state}`, { host: "evil.test" })
        .status,
      403,
    );
    assert.equal(
      request(`/oauth2callback?code=fake&state=${state}`, {
        host: "localhost:8085",
        origin: "https://evil.test",
      }).status,
      403,
    );
    assert.equal(
      request(`/oauth2callback?code=fake&state=${state}`, undefined, "POST")
        .status,
      403,
    );
    assert.equal(closed, false);
    assert.lengthOf(writes, 0);
    const accepted = request(
      `/oauth2callback?error=${encodeURIComponent("<script>evil</script>")}&state=${state}`,
    );
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers["Content-Type"], "text/plain; charset=utf-8");
    assert.notInclude(accepted.body, "<script>");
    assert.equal(writes[0][2].mode, 0o600);
    assert.equal(writes[0][2].flag, "wx");
    assert.equal(closed, true);
  });
  it("checks the returned state before token exchange", () => {
    assert.isTrue(oauthStateMatches("f".repeat(64), "f".repeat(64)));
    assert.isFalse(oauthStateMatches(undefined, "f".repeat(64)));
    assert.isFalse(oauthStateMatches("e".repeat(64), "f".repeat(64)));
  });
});
