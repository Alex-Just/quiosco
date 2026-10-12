import { describe, expect, it } from "vitest";
import { zenEndActions } from "./zenEndActions";

describe("zenEndActions", () => {
  it("offers archive and delete for an article that is not archived", () => {
    expect(zenEndActions({ status: "unread" })).toEqual(["archive", "delete"]);
    expect(zenEndActions({ status: "read" })).toEqual(["archive", "delete"]);
  });

  it("drops archive once the article is archived", () => {
    expect(zenEndActions({ status: "archived" })).toEqual(["delete"]);
  });
});
