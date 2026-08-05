// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, within, fireEvent, act, cleanup } from "@testing-library/react";
import { PremiumSelect } from "./PremiumSelect";

// jsdom implements no layout, so it ships no scrollIntoView. The component
// calls it to keep the arrow-key cursor in view; without a stub every test
// dies inside that effect rather than on anything it is actually checking.
Element.prototype.scrollIntoView = () => {};

// The open panel is portalled onto document.body, so it outlives an unmounted
// tree unless cleanup runs. This project doesn't enable vitest globals, which
// is what would otherwise wire Testing Library's automatic cleanup up.
afterEach(cleanup);

const AGENTS = [
  { value: "", label: "Все агенты" },
  { value: "10", label: "Азиз (14)" },
  { value: "20", label: "Дилшод (9)" },
  { value: "30", label: "Мадина (3)" },
];

/** Drives the component the way the Orders page does — controlled, from state. */
function MultiHarness({ onChange }: { onChange?: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <PremiumSelect
      multiple
      value={value}
      onChange={v => { setValue(v); onChange?.(v); }}
      options={AGENTS}
      placeholder="Все агенты"
      summarize={n => `Агентов: ${n}`}
      aria-label="Агент"
    />
  );
}

// fireEvent rather than user-event: the latter isn't a dependency here, and
// this component's rows respond to a plain click.
const click = (el: HTMLElement) => act(() => { fireEvent.click(el); });

const openPanel = () => {
  click(screen.getByRole("combobox", { name: "Агент" }));
  return screen.getByRole("listbox");
};

const pick = (panel: HTMLElement, label: string) =>
  within(panel).getByRole("option", { name: label });

describe("PremiumSelect — multiple", () => {
  it("keeps the panel open so several agents can be picked in one go", () => {
    render(<MultiHarness />);

    const panel = openPanel();
    click(pick(panel, "Азиз (14)"));

    // A single-select closes here. Reopening between every name is exactly the
    // friction this replaces, so the panel has to survive the click.
    expect(screen.getByRole("listbox")).toBeTruthy();

    click(pick(screen.getByRole("listbox"), "Мадина (3)"));

    expect(pick(screen.getByRole("listbox"), "Азиз (14)").getAttribute("aria-selected")).toBe("true");
    expect(pick(screen.getByRole("listbox"), "Мадина (3)").getAttribute("aria-selected")).toBe("true");
    expect(pick(screen.getByRole("listbox"), "Дилшод (9)").getAttribute("aria-selected")).toBe("false");
  });

  it("reports every picked agent to the caller", () => {
    const onChange = vi.fn();
    render(<MultiHarness onChange={onChange} />);

    const panel = openPanel();
    click(pick(panel, "Азиз (14)"));
    click(pick(screen.getByRole("listbox"), "Дилшод (9)"));

    expect(onChange).toHaveBeenLastCalledWith(["10", "20"]);
  });

  it("un-picks an agent clicked a second time", () => {
    const onChange = vi.fn();
    render(<MultiHarness onChange={onChange} />);

    const panel = openPanel();
    click(pick(panel, "Азиз (14)"));
    click(pick(screen.getByRole("listbox"), "Азиз (14)"));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  // "Все агенты" is the way back to an unfiltered list. Treating it as just
  // another option would leave it selected alongside real agents and produce a
  // filter nobody asked for.
  it("clears the selection when the everyone row is picked", () => {
    const onChange = vi.fn();
    render(<MultiHarness onChange={onChange} />);

    const panel = openPanel();
    click(pick(panel, "Азиз (14)"));
    click(pick(screen.getByRole("listbox"), "Мадина (3)"));
    click(pick(screen.getByRole("listbox"), "Все агенты"));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("names one or two agents on the trigger, and counts beyond that", () => {
    render(<MultiHarness />);
    const trigger = screen.getByRole("combobox", { name: "Агент" });

    expect(trigger.textContent).toContain("Все агенты");

    const panel = openPanel();
    click(pick(panel, "Азиз (14)"));
    expect(trigger.textContent).toContain("Азиз (14)");

    click(pick(screen.getByRole("listbox"), "Дилшод (9)"));
    expect(trigger.textContent).toContain("Азиз (14), Дилшод (9)");

    // Three names would overflow the 200px control and truncate to nothing
    // readable, so it switches to a count.
    click(pick(screen.getByRole("listbox"), "Мадина (3)"));
    expect(trigger.textContent).toContain("Агентов: 3");
  });

  it("tells assistive tech that more than one option can be chosen", () => {
    render(<MultiHarness />);

    const panel = openPanel();

    expect(panel.getAttribute("aria-multiselectable")).toBe("true");
  });
});

describe("PremiumSelect — single", () => {
  // The multi-select was added to an existing component that every other
  // toolbar on the site uses; single-select behaviour has to be untouched.
  function SingleHarness({ onChange }: { onChange: (v: string) => void }) {
    const [value, setValue] = useState("");
    return (
      <PremiumSelect
        value={value}
        onChange={v => { setValue(v); onChange(v); }}
        options={AGENTS}
        aria-label="Агент"
      />
    );
  }

  it("still commits once and closes", () => {
    const onChange = vi.fn();
    render(<SingleHarness onChange={onChange} />);

    const panel = openPanel();
    click(pick(panel, "Дилшод (9)"));

    expect(onChange).toHaveBeenCalledWith("20");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not advertise multi-selection", () => {
    render(<SingleHarness onChange={vi.fn()} />);

    const panel = openPanel();

    expect(panel.getAttribute("aria-multiselectable")).toBeNull();
  });
});
