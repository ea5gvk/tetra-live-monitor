export default function Calculator() {
  return (
    <div className="h-screen w-full" data-testid="page-calculator">
      <iframe
        src="/calculator.html"
        className="w-full h-full border-0"
        title="TETRA Frequency Calculator"
        data-testid="iframe-calculator"
      />
    </div>
  );
}
