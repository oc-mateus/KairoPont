export default function LoadError({ message = 'Não foi possível carregar os dados. Confira sua conexão e tente novamente.', onRetry }) {
  return (
    <section className="load-error" aria-label="Falha no carregamento">
      <p role="alert">{message}</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>Tentar novamente</button>
    </section>
  );
}
