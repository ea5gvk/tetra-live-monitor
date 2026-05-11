import { useEffect, useState, useCallback, useRef } from "react";
import { Keyboard, X, Delete, CornerDownLeft, ArrowBigUp } from "lucide-react";

const STORAGE_KEY = "tetra_touch_mode";

type Layer = "letters" | "numbers" | "symbols";

const LAYERS: Record<Layer, string[][]> = {
  letters: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["z", "x", "c", "v", "b", "n", "m", ",", "."],
  ],
  numbers: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""],
    [".", ",", "?", "!", "'", "+", "=", "_", "*"],
  ],
  symbols: [
    ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
    ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "·"],
    [".", ",", "?", "!", "'", "\"", ";", ":", "/"],
  ],
};

function isEditable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  return ["text", "number", "password", "email", "search", "tel", "url", ""].includes(type);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function readTouchMode(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

function writeTouchMode(v: boolean) {
  try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch {}
}

export function TouchModeToggle() {
  const [on, setOn] = useState(readTouchMode);

  function toggle() {
    const next = !on;
    setOn(next);
    writeTouchMode(next);
    window.dispatchEvent(new CustomEvent("tetra:touchmode", { detail: next }));
    // Notify same-origin iframes (e.g. /calculator) so they can show their own keyboard.
    document.querySelectorAll("iframe").forEach(f => {
      try { (f as HTMLIFrameElement).contentWindow?.postMessage({ type: "touch-mode", on: next }, "*"); } catch {}
    });
  }

  return (
    <button
      onClick={toggle}
      title={on ? "Modo táctil: ACTIVO (clic para desactivar)" : "Modo táctil: INACTIVO (clic para activar)"}
      data-testid="button-touch-mode"
      className={`p-1 rounded border transition-all ${
        on
          ? "bg-amber-500/20 text-amber-300 border-amber-500/50 hover:bg-amber-500/30"
          : "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10 hover:text-foreground"
      }`}
    >
      <Keyboard className="w-3.5 h-3.5" />
    </button>
  );
}

export function TouchKeyboard() {
  const [enabled, setEnabled] = useState(readTouchMode);
  const [target, setTarget] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [layer, setLayer] = useState<Layer>("letters");
  const [shift, setShift] = useState(false);
  const targetRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => { targetRef.current = target; }, [target]);

  useEffect(() => {
    function onMode(e: Event) {
      const ce = e as CustomEvent<boolean>;
      setEnabled(!!ce.detail);
      if (!ce.detail) setTarget(null);
    }
    window.addEventListener("tetra:touchmode", onMode);
    return () => window.removeEventListener("tetra:touchmode", onMode);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    function onFocusIn(e: FocusEvent) {
      const el = e.target as Element;
      if (isEditable(el)) {
        setTarget(el as HTMLInputElement | HTMLTextAreaElement);
      }
    }
    function onPointerDown(e: PointerEvent) {
      // If user clicks outside both the keyboard and any input, hide it.
      const path = e.composedPath();
      const onKb = path.some(n => (n as HTMLElement)?.dataset?.touchKb === "1");
      const onInput = path.some(n => isEditable(n as Element));
      if (!onKb && !onInput) setTarget(null);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [enabled]);

  const press = useCallback((char: string) => {
    const el = targetRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const out = shift && layer === "letters" ? char.toUpperCase() : char;
    const newVal = before + out + after;
    if ((el as HTMLInputElement).type === "number") {
      // Number inputs reject non-numeric chars; only commit if valid.
      if (!/^-?\d*\.?\d*$/.test(newVal)) return;
    }
    setNativeValue(el, newVal);
    const pos = start + out.length;
    try { el.setSelectionRange(pos, pos); } catch {}
    if (shift && layer === "letters") setShift(false);
  }, [shift, layer]);

  const backspace = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (start === 0 && end === 0) return;
    const cut = start === end ? start - 1 : start;
    const before = el.value.slice(0, cut);
    const after = el.value.slice(end);
    setNativeValue(el, before + after);
    try { el.setSelectionRange(cut, cut); } catch {}
  }, []);

  const enter = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    if (el instanceof HTMLTextAreaElement) {
      press("\n");
      return;
    }
    // Submit the closest form if any, else fire a keydown(Enter) for handlers.
    const form = el.form;
    if (form) {
      const evt = new Event("submit", { bubbles: true, cancelable: true });
      if (form.dispatchEvent(evt)) form.requestSubmit?.();
    } else {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    }
  }, [press]);

  if (!enabled || !target) return null;

  const rows = LAYERS[layer];

  // Prevent stealing focus from the input when tapping keys.
  const noBlur = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

  return (
    <div
      data-touch-kb="1"
      className="fixed bottom-0 left-0 right-0 z-[60] bg-card/95 backdrop-blur border-t-2 border-amber-500/40 shadow-2xl select-none"
      onPointerDown={noBlur}
      onMouseDown={noBlur}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 text-[10px] font-bold text-amber-300/80">
        <span className="flex items-center gap-1.5">
          <Keyboard className="w-3 h-3" />
          TECLADO TÁCTIL
        </span>
        <button
          onClick={() => setTarget(null)}
          className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
          data-testid="button-touch-kb-close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2 space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1 justify-center">
            {row.map(k => {
              const display = shift && layer === "letters" ? k.toUpperCase() : k;
              return (
                <button
                  key={k}
                  data-touch-kb="1"
                  onClick={() => press(k)}
                  className="flex-1 max-w-[10%] min-w-0 h-12 sm:h-11 rounded-md bg-white/10 hover:bg-white/20 active:bg-amber-500/40 text-foreground font-mono text-base sm:text-sm font-bold border border-border/30 transition-colors"
                >
                  {display}
                </button>
              );
            })}
          </div>
        ))}

        <div className="flex gap-1 justify-center">
          {layer === "letters" ? (
            <button
              data-touch-kb="1"
              onClick={() => setShift(s => !s)}
              className={`h-12 sm:h-11 px-3 rounded-md font-bold text-xs border transition-colors ${
                shift
                  ? "bg-amber-500/40 text-amber-100 border-amber-400"
                  : "bg-white/10 hover:bg-white/20 text-foreground border-border/30"
              }`}
            >
              <ArrowBigUp className="w-4 h-4" />
            </button>
          ) : (
            <button
              data-touch-kb="1"
              onClick={() => setLayer(layer === "numbers" ? "symbols" : "numbers")}
              className="h-12 sm:h-11 px-3 rounded-md font-bold text-xs bg-white/10 hover:bg-white/20 text-foreground border border-border/30"
            >
              {layer === "numbers" ? "#+=" : "123"}
            </button>
          )}

          <button
            data-touch-kb="1"
            onClick={() => setLayer(layer === "letters" ? "numbers" : "letters")}
            className="h-12 sm:h-11 px-3 rounded-md font-bold text-xs bg-white/10 hover:bg-white/20 text-foreground border border-border/30"
          >
            {layer === "letters" ? "123" : "ABC"}
          </button>

          <button
            data-touch-kb="1"
            onClick={() => press(" ")}
            className="flex-1 h-12 sm:h-11 rounded-md bg-white/10 hover:bg-white/20 text-foreground border border-border/30 text-xs font-bold"
          >
            ESPACIO
          </button>

          <button
            data-touch-kb="1"
            onClick={backspace}
            className="h-12 sm:h-11 px-3 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 transition-colors"
          >
            <Delete className="w-4 h-4" />
          </button>

          <button
            data-touch-kb="1"
            onClick={enter}
            className="h-12 sm:h-11 px-3 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 transition-colors"
          >
            <CornerDownLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
