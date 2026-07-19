// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import ErrorBoundary from "../components/ErrorBoundary";

// ── Helper components ───────────────────────────────────────────────────────
function GoodChild() {
  return <div data-testid="good">Hello World</div>;
}

function BadChild() {
  throw new Error("Test error message");
}

function BadChildSilent() {
  // Throws during render but without a message
  throw new Error();
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe("ErrorBoundary", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    // Suppress console.error from componentDidCatch
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("good")).toBeTruthy();
  });

  it("renders error UI when child throws", () => {
    render(
      <ErrorBoundary>
        <BadChild />
      </ErrorBoundary>
    );
    expect(screen.getByText("Что-то пошло не так")).toBeTruthy();
  });

  it("shows generic message when no pageName", () => {
    render(
      <ErrorBoundary>
        <BadChild />
      </ErrorBoundary>
    );
    expect(screen.getByText("Произошла непредвиденная ошибка. Попробуйте обновить страницу.")).toBeTruthy();
  });

  it("shows pageName-specific message when provided", () => {
    render(
      <ErrorBoundary pageName="Склад">
        <BadChild />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Ошибка на странице «Склад»/)).toBeTruthy();
  });

  it("shows error details in expandable section", () => {
    render(
      <ErrorBoundary>
        <BadChild />
      </ErrorBoundary>
    );
    const details = screen.getByText("Технические детали");
    expect(details).toBeTruthy();
    // Click to expand
    details.click();
    expect(screen.getByText(/Test error message/)).toBeTruthy();
  });

  it("logs error to console", () => {
    render(
      <ErrorBoundary pageName="Test">
        <BadChild />
      </ErrorBoundary>
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("renders refresh button", () => {
    render(
      <ErrorBoundary>
        <BadChild />
      </ErrorBoundary>
    );
    expect(screen.getByText("Обновить")).toBeTruthy();
  });

  it("renders home link", () => {
    render(
      <ErrorBoundary>
        <BadChild />
      </ErrorBoundary>
    );
    expect(screen.getByText("На главную")).toBeTruthy();
  });

  it("does not crash when error has no message", () => {
    render(
      <ErrorBoundary>
        <BadChildSilent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Что-то пошло не так")).toBeTruthy();
  });
});
