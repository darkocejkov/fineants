import { describe, it, expect } from "vitest";
import { attributeErrors } from "@/lib/sync/attribution";

const conns = [
  { id: "c-td", name: "TD Canada Trust" },
  { id: "c-tang", name: "Tangerine" },
];

describe("attributeErrors", () => {
  it("uses conn_id when present", () => {
    const r = attributeErrors([{ code: "con.auth", msg: "Please re-authenticate", connId: "c-tang" }], conns);
    expect(r.items[0].attributedConnectionId).toBe("c-tang");
    expect(r.heldAll).toBe(false);
    expect([...r.heldIds]).toEqual(["c-tang"]);
  });
  it("matches a single connection name inside the message, case-insensitively", () => {
    const r = attributeErrors([{ code: "gen.legacy", msg: "Connection to td canada trust may need attention. Auth required" }], conns);
    expect(r.items[0].attributedConnectionId).toBe("c-td");
    expect(r.heldAll).toBe(false);
  });
  it("holds everything when the message names no connection", () => {
    const r = attributeErrors([{ code: "gen.legacy", msg: "Something else happened" }], conns);
    expect(r.items[0].attributedConnectionId).toBeUndefined();
    expect(r.heldAll).toBe(true);
    expect([...r.heldIds].sort()).toEqual(["c-tang", "c-td"]);
  });
  it("holds everything when the message names more than one connection", () => {
    const r = attributeErrors([{ code: "x", msg: "TD Canada Trust and Tangerine both down" }], conns);
    expect(r.heldAll).toBe(true);
  });
  it("an unknown conn_id also holds everything", () => {
    const r = attributeErrors([{ code: "x", msg: "m", connId: "c-unknown" }], conns);
    expect(r.heldAll).toBe(true);
  });
  it("empty errlist holds nothing", () => {
    const r = attributeErrors([], conns);
    expect(r.heldAll).toBe(false);
    expect(r.heldIds.size).toBe(0);
  });
});
