export function FinvizProfileLink({ ticker }: { readonly ticker: string }) {
  return (
    <a
      href={`https://finviz.com/stock?t=${encodeURIComponent(ticker)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="w-fit text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      Ver perfil en Finviz
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}
