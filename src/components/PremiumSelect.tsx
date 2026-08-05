import { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

interface CommonProps {
  options: { value: string; label: string }[];
  placeholder?: string;
  width?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

interface SingleProps extends CommonProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}

interface MultiProps extends CommonProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
  /**
   * Shown on the trigger once more than one option is picked, e.g.
   * `(n) => `${n} агентов``. Falls back to listing the labels.
   */
  summarize?: (count: number) => string;
}

/**
 * Discriminating on `multiple` keeps both shapes honest at the call site: a
 * multi-select can't be handed a plain string, and a single select can't get an
 * array. The alternative — one loose `value: string | string[]` — pushes that
 * check to runtime, which is exactly where a filter silently matching nothing
 * would hide.
 */
type PremiumSelectProps = SingleProps | MultiProps;

/** Rows are a fixed height, so the panel can be sized before it is measured. */
const ROW = 38;
const PANEL_PADDING = 8;
const GAP = 6;
const MAX_PANEL = 280;

export function PremiumSelect(props: PremiumSelectProps) {
  const {
    options, placeholder = "Выберите...", width, disabled,
    "aria-label": ariaLabel,
  } = props;
  const multiple = props.multiple === true;
  const selectedValues = multiple ? props.value : [];
  const value = multiple ? "" : props.value;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: MAX_PANEL, above: false });

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const typeahead = useRef({ term: "", at: 0 });
  const listId = useId();

  const isPicked = useCallback(
    (v: string) => (multiple ? selectedValues.includes(v) : v === value),
    [multiple, selectedValues, value],
  );

  const selectedIndex = multiple
    ? options.findIndex(o => selectedValues.includes(o.value))
    : options.findIndex(o => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  /**
   * What the closed trigger says.
   *
   * With several agents picked, listing every name overflows a 200px control
   * and truncates to something unreadable, so past the first two we fall back
   * to a count — the caller supplies the wording so it can be pluralised and
   * translated properly.
   */
  const triggerLabel = (() => {
    if (!multiple) return selected?.label;
    if (selectedValues.length === 0) return undefined;
    const picked = options.filter(o => selectedValues.includes(o.value));
    if (picked.length <= 2) return picked.map(o => o.label).join(", ");
    return props.summarize?.(picked.length) ?? picked.map(o => o.label).join(", ");
  })();

  /**
   * The panel is fixed-positioned, so it has to be re-placed whenever anything
   * moves it relative to the trigger. Measuring only on open left it stranded
   * mid-page the moment the user scrolled.
   */
  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const wanted = Math.min(MAX_PANEL, options.length * ROW + PANEL_PADDING);
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    // Open upwards when the space below cannot hold the list but the space
    // above can — otherwise the last options sit off the bottom of the screen.
    const flip = below < wanted && above > below;
    setPos({
      top: flip ? Math.max(8, r.top - GAP - Math.min(wanted, above)) : r.bottom + GAP,
      left: r.left,
      width: r.width,
      maxHeight: Math.max(ROW + PANEL_PADDING, Math.min(wanted, flip ? above : below)),
      above: flip,
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    place();
    // `capture` so scrolling inside any ancestor counts, not just the window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    panelRef.current?.querySelectorAll("[role=option]")[activeIndex]
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function commit(index: number) {
    const opt = options[index];
    if (!opt) return;

    if (props.multiple) {
      // Picking agents to compare is a several-clicks job, so the panel stays
      // open and each row toggles. An option with an empty value is the
      // "everyone" row — it clears the selection rather than joining it.
      props.onChange(
        opt.value === ""
          ? []
          : props.value.includes(opt.value)
            ? props.value.filter(v => v !== opt.value)
            : [...props.value, opt.value],
      );
      return;
    }

    props.onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function openWith(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    const last = options.length - 1;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openWith(selectedIndex >= 0 ? selectedIndex : 0);
      }
      return;
    }

    switch (e.key) {
      case "Escape":    e.preventDefault(); setOpen(false); triggerRef.current?.focus(); return;
      case "Tab":       setOpen(false); return;
      case "Enter":
      case " ":         e.preventDefault(); commit(activeIndex); return;
      case "ArrowDown": e.preventDefault(); setActiveIndex(i => (i >= last ? 0 : i + 1)); return;
      case "ArrowUp":   e.preventDefault(); setActiveIndex(i => (i <= 0 ? last : i - 1)); return;
      case "Home":      e.preventDefault(); setActiveIndex(0); return;
      case "End":       e.preventDefault(); setActiveIndex(last); return;
    }

    // Typeahead: consecutive letters build a search term, as a native select does.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const t = typeahead.current;
      t.term = now - t.at > 700 ? e.key : t.term + e.key;
      t.at = now;
      const hit = options.findIndex(o => o.label.toLowerCase().startsWith(t.term.toLowerCase()));
      if (hit >= 0) setActiveIndex(hit);
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative", width: width || "auto" }}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openWith(selectedIndex >= 0 ? selectedIndex : 0))}
        onKeyDown={onKeyDown}
        className={`premium-select-trigger${open ? " open" : ""}`}
      >
        <span className="premium-select-label" data-placeholder={triggerLabel ? undefined : ""}>
          {triggerLabel ?? placeholder}
        </span>
        <ChevronDown size={16} className="premium-select-chevron" aria-hidden />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          id={listId}
          role="listbox"
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-multiselectable={multiple || undefined}
          className={`premium-select-panel${pos.above ? " above" : ""}`}
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        >
          {options.map((opt, i) => (
            <div
              key={opt.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={isPicked(opt.value)}
              data-active={i === activeIndex ? "" : undefined}
              className="premium-select-option"
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => commit(i)}
            >
              {/* The tick lives in a reserved gutter: rendering it only for the
                  selected row used to shove that one label sideways. */}
              <span className="premium-select-tick" aria-hidden>
                {isPicked(opt.value) && <Check size={14} strokeWidth={3} />}
              </span>
              <span className="premium-select-option-label">{opt.label}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
