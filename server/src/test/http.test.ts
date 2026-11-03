import { test } from "node:test";
import assert from "node:assert/strict";
import { getJson, HttpError } from "../adapters/outbound/fetchers/http.js";

test("getJson: retry su 5xx poi ok; errore finale redacta la query string (niente leak api key)", async () => {
  let calls = 0;
  const mockFetch = (async () => {
    calls++;
    if (calls === 1) return new Response("err", { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  const data = await getJson(mockFetch, "https://api.example.com/x?apikey=SECRET123", {}, 2);
  assert.deepEqual(data, { ok: true });
  assert.equal(calls, 2);

  const always401 = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(
    () => getJson(always401, "https://api.example.com/x?apikey=SECRET123", {}, 1),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).status, 401);
      assert.ok(!(err as Error).message.includes("SECRET123"));
      assert.ok((err as Error).message.includes("HTTP 401"));
      return true;
    },
  );
});

test("getJson: 401 non viene ritentato", async () => {
  let calls = 0;
  const mockFetch = (async () => {
    calls++;
    return new Response("nope", { status: 401 });
  }) as unknown as typeof fetch;
  await assert.rejects(() => getJson(mockFetch, "https://api.example.com/x", {}, 3));
  assert.equal(calls, 1);
});
