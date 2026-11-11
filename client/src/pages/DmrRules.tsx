// The DMRGateway network rules guide (client/public/dmr-rules.html, the same page as the shared guide), always at hand
// next to CONFIG DMR. It follows the panel's theme by itself (same-origin iframe).
export default function DmrRules() {
  return (
    <div className="h-screen w-full flex flex-col" data-testid="page-dmr-rules">
      <iframe src="/dmr-rules.html" className="w-full flex-1 border-0" title="Reglas de red DMRGateway" data-testid="iframe-dmr-rules" />
    </div>
  );
}
