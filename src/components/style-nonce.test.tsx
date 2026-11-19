// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { getNonce } from "get-nonce";
import { afterEach, describe, expect, it } from "vitest";
import { documentNonce, StyleNonce } from "./style-nonce";

function addScript(nonce: string) {
  const s = document.createElement("script");
  s.nonce = nonce;
  document.head.appendChild(s);
}

afterEach(() => {
  for (const s of document.head.querySelectorAll("script")) s.remove();
});

describe("StyleNonce", () => {
  it("hands the document's own nonce to get-nonce and renders nothing", () => {
    addScript("doc-nonce");
    const { container } = render(<StyleNonce />);
    expect(getNonce()).toBe("doc-nonce");
    expect(container).toBeEmptyDOMElement();
  });

  it("finds no nonce on a page without nonce scripts (the static routes)", () => {
    expect(documentNonce(document)).toBeUndefined();
  });
});
