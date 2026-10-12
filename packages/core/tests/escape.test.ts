import { describe, expect, test } from "bun:test";
import { decodeEntities, escapeLineStarts, escapeMarkup, labelName, str } from "../src/escape.ts";

describe("escaping", () => {
  test("markup characters", () => {
    expect(escapeMarkup("a*b_c#d$e@f<g>[h]`~\\")).toBe("a\\*b\\_c\\#d\\$e\\@f\\<g>\\[h\\]\\`\\~\\\\");
  });
  test("hyphen runs, comment starts and ellipses", () => {
    expect(escapeMarkup("a--b")).toBe("a\\-\\-b");
    // Otherwise `#link(..)[x];` swallows the semicolon.
    expect(escapeMarkup("x; y")).toBe("x\\; y");
    expect(escapeMarkup("a//b")).toBe("a\\//b");
    expect(escapeMarkup("x...")).toBe("x\\...");
  });
  test("colons are only escaped on request (term lists)", () => {
    expect(escapeMarkup("a: b")).toBe("a: b");
    expect(escapeMarkup("a: b", true)).toBe("a\\: b");
  });
  test("line starts that would become structure", () => {
    expect(escapeLineStarts("= not heading\n- not list\n1. not enum\n+ plus\n/ term")).toBe(
      "\\= not heading\n\\- not list\n1\\. not enum\n\\+ plus\n\\/ term",
    );
  });
  test("string literals", () => {
    expect(str('a"b\\c\nd\te')).toBe('"a\\"b\\\\c\\nd\\te"');
  });
  test("labels", () => {
    expect(labelName("a b/c:d.e-f_g")).toBe("a_b_c:d.e-f_g");
  });
  test("entities", () => {
    expect(decodeEntities("&amp; &#8364; &copy; &#x2014; &unknown;")).toBe("& € © — &unknown;");
  });
});
