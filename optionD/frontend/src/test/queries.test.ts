import { describe, expect, it } from "vitest";
import { submissionQuery, submissionsQuery } from "../api/queries";

// The provisioning poll is declarative: refetchInterval returns 800ms while any
// app is mid-provision, false otherwise. Exercise both functions directly.

type IntervalFn = (q: { state: { data: unknown } }) => number | false;

describe("submissionsQuery.refetchInterval", () => {
  const fn = submissionsQuery.refetchInterval as unknown as IntervalFn;

  it("polls at 800ms while any submission is provisioning", () => {
    expect(fn({ state: { data: [{ status: "live" }, { status: "provisioning" }] } })).toBe(800);
  });

  it("stops polling when none are provisioning", () => {
    expect(fn({ state: { data: [{ status: "live" }, { status: "review" }] } })).toBe(false);
  });
});

describe("submissionQuery", () => {
  it("is disabled without an id", () => {
    expect(submissionQuery(undefined).enabled).toBe(false);
  });

  it("polls at 800ms while the selected app is provisioning", () => {
    const fn = submissionQuery("sub-1").refetchInterval as unknown as IntervalFn;
    expect(fn({ state: { data: { submission: { status: "provisioning" } } } })).toBe(800);
    expect(fn({ state: { data: { submission: { status: "live" } } } })).toBe(false);
  });
});
