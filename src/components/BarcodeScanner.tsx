/**
 * BarcodeScanner — uses the browser's camera via BarcodeDetector API.
 * Falls back to manual input if BarcodeDetector is not supported.
 *
 * Compatible with: Chrome 83+, Edge 83+, Opera 69+, Android Chrome.
 * Safari iOS 17.4+ also supports BarcodeDetector.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { X, Keyboard, CheckCircle2 } from "lucide-react";

interface Props {
  onScan:   (code: string) => void;
  onClose:  () => void;
  label?:   string;
}

const SUPPORTED = typeof window !== "undefined" && "BarcodeDetector" in window;

export function BarcodeScanner({ onScan, onClose, label = "Scan barcode" }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const [manual, setManual]   = useState(!SUPPORTED);
  const [input,  setInput]    = useState("");
  const [error,  setError]    = useState("");
  const [scanned, setScanned] = useState<string | null>(null);
  const scanning = useRef(true);

  const stopCamera = useCallback(() => {
    scanning.current = false;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const handleDetected = useCallback((code: string) => {
    if (!scanning.current) return;
    scanning.current = false;
    setScanned(code);
    // Short delay so user sees the result before closing
    setTimeout(() => { onScan(code); stopCamera(); }, 600);
  }, [onScan, stopCamera]);

  useEffect(() => {
    if (manual || !SUPPORTED) return;

    let rafId: number;

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then(stream => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      const detector = new (window as unknown as { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (el: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector({
        formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf"],
      });

      const tick = async () => {
        if (!scanning.current || !videoRef.current) return;
        if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleDetected(barcodes[0].rawValue);
              return;
            }
          } catch { /* ignore detection errors */ }
        }
        rafId = requestAnimationFrame(tick);
      };

      videoRef.current?.addEventListener("playing", () => { rafId = requestAnimationFrame(tick); }, { once: true });
    }).catch(() => {
      setError("Нет доступа к камере. Используйте ручной ввод.");
      setManual(true);
    });

    return () => {
      cancelAnimationFrame(rafId);
      stopCamera();
    };
  }, [manual, handleDetected, stopCamera]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-sm bg-surface rounded-xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-custom">
          <span className="font-label text-text-primary tracking-wider text-sm">{label}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setManual(v => !v)}
              className={`p-1.5 rounded transition-colors ${manual ? "text-primary" : "text-text-secondary hover:text-text-primary"}`}
              title="Ручной ввод"
            >
              <Keyboard size={18}/>
            </button>
            <button onClick={onClose} className="text-text-secondary hover:text-text-primary p-1.5">
              <X size={18}/>
            </button>
          </div>
        </div>

        {/* Camera or manual */}
        {manual ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-text-secondary">Введите штрих-код вручную:</p>
            <input
              className="input-field w-full font-data text-lg"
              placeholder="Код товара…"
              value={input}
              onChange={e => setInput(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && input.trim()) onScan(input.trim()); }}
            />
            <button
              onClick={() => input.trim() && onScan(input.trim())}
              disabled={!input.trim()}
              className="btn-primary w-full disabled:opacity-40"
            >
              Применить
            </button>
            {!SUPPORTED && (
              <p className="text-xs text-text-secondary text-center">
                BarcodeDetector не поддерживается в этом браузере
              </p>
            )}
          </div>
        ) : (
          <div className="relative bg-black" style={{ height: 320 }}>
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline/>

            {/* Scan overlay */}
            {!scanned && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-56 h-36">
                  {/* Corner brackets */}
                  {[
                    "top-0 left-0 border-t-2 border-l-2",
                    "top-0 right-0 border-t-2 border-r-2",
                    "bottom-0 left-0 border-b-2 border-l-2",
                    "bottom-0 right-0 border-b-2 border-r-2",
                  ].map((cls, i) => (
                    <div key={i} className={`absolute w-6 h-6 border-primary ${cls}`}/>
                  ))}
                  {/* Scanning line */}
                  <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-primary/70 animate-pulse"/>
                </div>
              </div>
            )}

            {/* Success overlay */}
            {scanned && (
              <div className="absolute inset-0 bg-success/20 flex flex-col items-center justify-center gap-2">
                <CheckCircle2 size={48} className="text-success"/>
                <p className="font-data text-white text-lg font-bold">{scanned}</p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4">
                <p className="text-warning text-sm text-center">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Camera mode hint */}
        {!manual && !scanned && !error && (
          <div className="px-4 py-2 text-center">
            <p className="text-xs text-text-secondary">Наведите камеру на штрих-код</p>
          </div>
        )}
      </div>
    </div>
  );
}
