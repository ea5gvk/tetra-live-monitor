import { useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";

export default function Calculator() {
  const { lang } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: "setLang", lang }, "*");
    }
  }, [lang]);

  const handleLoad = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: "setLang", lang }, "*");
    }
  };

  return (
    <div className="h-screen w-full" data-testid="page-calculator">
      <iframe
        ref={iframeRef}
        src="/calculator.html"
        className="w-full h-full border-0"
        title="TETRA Frequency Calculator"
        onLoad={handleLoad}
        data-testid="iframe-calculator"
      />
    </div>
  );
}
