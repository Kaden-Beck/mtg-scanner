import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the app name", () => {
    render(<Home />);
    expect(screen.getByText("MTG Scanner")).toBeInTheDocument();
  });
});
