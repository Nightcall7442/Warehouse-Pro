// @vitest-environment jsdom
/**
 * Политика конфиденциальности называет контакт для вопросов о данных прямо,
 * а не «контакт на главной», где его не было (10.10.2026). Почта — та же,
 * что в подвале лендинга (CONTACT.email), одна на оба места.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Privacy from "@/pages/Privacy";
import { CONTACT } from "@/components/landing/landing-tokens";

afterEach(cleanup);

describe("политика конфиденциальности: контакт", () => {
  it("почта поддержки — ссылкой, та же, что на главной", () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>);
    const a = screen.getByTestId("privacy-support-email");
    expect(CONTACT.email).toBeTruthy();
    expect(a.getAttribute("href")).toBe(`mailto:${CONTACT.email}`);
  });
});
